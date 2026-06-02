/*
 * 가격엔진.js  —  비트코인 실시간 가격 수집 모듈
 * 전역: window.가격엔진
 *
 * 인터페이스 계약서 3절 규격 정확 구현:
 *   - 가격엔진.시작()        : 바이낸스 WebSocket 연결(실패 시 REST 폴백)
 *   - 가격엔진.구독(콜백)     : 새 가격이 올 때마다 콜백(가격숫자USD) 호출(여러 구독 허용)
 *   - 가격엔진.현재가()       : 마지막 가격(number) 반환, 없으면 null
 *   - 가격엔진.상태구독(콜백) : 연결상태 변화 시 콜백("연결"|"재연결"|"끊김")
 *   - 자동 재연결(지수 백오프) 포함
 *
 * 순수 바닐라 JS. 외부 라이브러리 의존성 0. API 키 불필요.
 */
(function (전역) {
  'use strict';

  // ===== 설정 상수 =====
  var WS_주소 = 'wss://stream.binance.com:9443/ws/btcusdt@trade';
  var REST_주소 = 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT';
  var REST_폴링간격_ms = 3000;     // REST 폴백 폴링 주기 3초
  var 백오프_최소_ms = 1000;       // 지수 백오프 시작값 1초
  var 백오프_최대_ms = 30000;      // 지수 백오프 상한 30초

  // ===== 내부 상태 =====
  var 소켓 = null;                 // 현재 WebSocket 인스턴스
  var 마지막가격 = null;            // 가장 최근 가격(number) / 없으면 null
  var 가격구독자 = [];              // 가격 콜백 목록
  var 상태구독자 = [];              // 상태 콜백 목록
  var 현재상태 = null;              // "연결" | "재연결" | "끊김"
  var 재연결횟수 = 0;               // 지수 백오프 계산용
  var 재연결타이머 = null;          // setTimeout 핸들
  var REST타이머 = null;            // REST 폴링 setInterval 핸들
  var 실행중 = false;               // 시작() 호출 여부
  var 한번이라도연결됨 = false;      // 최초 연결인지 재연결인지 판별

  // WebSocket 생성자 확보(브라우저 = window.WebSocket, Node = 주입된 전역)
  function WS생성자() {
    return (typeof WebSocket !== 'undefined') ? WebSocket
         : (전역 && 전역.WebSocket) ? 전역.WebSocket
         : null;
  }

  // ===== 구독자 통지 =====
  function 가격통지(가격) {
    for (var i = 0; i < 가격구독자.length; i++) {
      try { 가격구독자[i](가격); }
      catch (e) { console.error('[가격엔진] 가격 구독자 콜백 오류:', e); }
    }
  }

  function 상태통지(상태) {
    if (상태 === 현재상태) return;   // 동일 상태 중복 통지 방지
    현재상태 = 상태;
    for (var i = 0; i < 상태구독자.length; i++) {
      try { 상태구독자[i](상태); }
      catch (e) { console.error('[가격엔진] 상태 구독자 콜백 오류:', e); }
    }
  }

  // 가격 문자열/숫자를 number로 파싱 후 저장·통지
  function 가격수신(원시값) {
    var 가격 = parseFloat(원시값);
    if (!isFinite(가격)) return;     // 숫자가 아니면 무시
    마지막가격 = 가격;
    가격통지(가격);
  }

  // ===== WebSocket 연결 =====
  function 웹소켓연결() {
    var Ctor = WS생성자();
    if (!Ctor) {
      // WebSocket 자체를 못 쓰는 환경 → 즉시 REST 폴백
      console.warn('[가격엔진] WebSocket 미지원 환경 → REST 폴백 사용');
      REST폴백시작();
      return;
    }

    // 최초/재연결 상태 통지
    상태통지(한번이라도연결됨 ? '재연결' : '연결');

    try {
      소켓 = new Ctor(WS_주소);
    } catch (e) {
      console.error('[가격엔진] WebSocket 생성 실패:', e);
      연결끊김처리();
      return;
    }

    소켓.onopen = function () {
      한번이라도연결됨 = true;
      재연결횟수 = 0;               // 백오프 리셋
      REST폴백중지();              // WS가 살아있으면 REST 불필요
      상태통지('연결');
      console.log('[가격엔진] 바이낸스 WebSocket 연결됨');
    };

    소켓.onmessage = function (이벤트) {
      try {
        var 데이터 = JSON.parse(이벤트.data);
        // btcusdt@trade 스트림은 체결가를 문자열 필드 p 로 제공
        if (데이터 && 데이터.p !== undefined) {
          가격수신(데이터.p);
        }
      } catch (e) {
        console.error('[가격엔진] 메시지 파싱 오류:', e);
      }
    };

    소켓.onerror = function (오류) {
      console.warn('[가격엔진] WebSocket 오류:', 오류 && 오류.message ? 오류.message : 오류);
      // onerror 후 보통 onclose가 이어짐. 여기서는 로그만.
    };

    소켓.onclose = function () {
      console.warn('[가격엔진] WebSocket 연결 종료됨');
      연결끊김처리();
    };
  }

  // 연결이 끊겼을 때: 끊김 통지 → REST 폴백 가동 → 지수 백오프 재연결 예약
  function 연결끊김처리() {
    소켓 = null;
    if (!실행중) return;            // 정지() 호출 후라면 재연결하지 않음

    상태통지('끊김');
    REST폴백시작();                // 끊긴 동안 가격 공백 최소화

    // 지수 백오프: 1s, 2s, 4s, ... 최대 30s
    var 대기 = Math.min(백오프_최소_ms * Math.pow(2, 재연결횟수), 백오프_최대_ms);
    재연결횟수++;
    console.log('[가격엔진] ' + (대기 / 1000) + '초 후 재연결 시도');

    if (재연결타이머) clearTimeout(재연결타이머);
    재연결타이머 = setTimeout(function () {
      if (실행중) 웹소켓연결();
    }, 대기);
  }

  // ===== REST 폴백 =====
  function REST폴백시작() {
    if (REST타이머) return;         // 이미 폴링 중이면 중복 시작 방지
    console.log('[가격엔진] REST 폴백 폴링 시작(3초 간격)');
    REST폴링1회();                 // 즉시 1회
    REST타이머 = setInterval(REST폴링1회, REST_폴링간격_ms);
  }

  function REST폴백중지() {
    if (REST타이머) {
      clearInterval(REST타이머);
      REST타이머 = null;
      console.log('[가격엔진] REST 폴백 폴링 중지');
    }
  }

  function REST폴링1회() {
    // fetch 우선, 없으면 조용히 무시(브라우저엔 항상 존재)
    if (typeof fetch !== 'function') {
      console.warn('[가격엔진] fetch 미지원 → REST 폴백 불가');
      return;
    }
    fetch(REST_주소)
      .then(function (응답) {
        if (!응답.ok) throw new Error('HTTP ' + 응답.status);
        return 응답.json();
      })
      .then(function (데이터) {
        // ticker/price 응답: { "symbol":"BTCUSDT", "price":"67000.00" }
        if (데이터 && 데이터.price !== undefined) {
          가격수신(데이터.price);
        }
      })
      .catch(function (e) {
        console.warn('[가격엔진] REST 폴링 실패:', e && e.message ? e.message : e);
      });
  }

  // ===== 공개 API =====
  var 가격엔진 = {
    // 엔진 시작: WebSocket 연결 시도(실패/끊김 시 자동으로 REST 폴백 + 재연결)
    시작: function () {
      if (실행중) {
        console.warn('[가격엔진] 이미 실행 중입니다');
        return;
      }
      실행중 = true;
      재연결횟수 = 0;
      한번이라도연결됨 = false;
      웹소켓연결();
    },

    // 새 가격이 올 때마다 콜백(가격숫자USD) 호출. 여러 구독 허용.
    구독: function (콜백) {
      if (typeof 콜백 === 'function') {
        가격구독자.push(콜백);
        // 이미 받은 가격이 있으면 즉시 1회 전달(늦게 구독해도 화면 비지 않게)
        if (마지막가격 !== null) {
          try { 콜백(마지막가격); } catch (e) { /* 무시 */ }
        }
      }
    },

    // 마지막 가격(number) 반환, 없으면 null
    현재가: function () {
      return 마지막가격;
    },

    // 연결상태 변화 시 콜백("연결"|"재연결"|"끊김")
    상태구독: function (콜백) {
      if (typeof 콜백 === 'function') {
        상태구독자.push(콜백);
        // 현재 상태가 있으면 즉시 1회 전달
        if (현재상태 !== null) {
          try { 콜백(현재상태); } catch (e) { /* 무시 */ }
        }
      }
    },

    // 엔진 정지(테스트/정리용 — 계약 외 보조 기능). 모든 타이머·소켓 해제.
    정지: function () {
      실행중 = false;
      if (재연결타이머) { clearTimeout(재연결타이머); 재연결타이머 = null; }
      REST폴백중지();
      if (소켓) {
        try { 소켓.onclose = null; 소켓.close(); } catch (e) { /* 무시 */ }
        소켓 = null;
      }
    },

    // ----- 테스트 전용 훅(자가검증용, 계약 외) -----
    // 가짜 trade 메시지를 주입해 내부 흐름을 검증한다.
    _모의메시지주입: function (가격) {
      가격수신(가격);
    }
  };

  전역.가격엔진 = 가격엔진;

  // Node 환경(자가검증)에서도 require 가능하도록 노출
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = 가격엔진;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
