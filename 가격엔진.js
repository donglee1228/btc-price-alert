/*
 * 가격엔진.js  —  실시간 가격 수집 모듈 (멀티코인: 비트코인 + 이더리움)
 * 전역: window.가격엔진
 *
 *   - 가격엔진.시작()              : 바이낸스 통합 WebSocket 연결(실패 시 REST 폴백)
 *   - 가격엔진.구독(콜백)           : 새 가격마다 콜백(코인키, 가격숫자USD) 호출(여러 구독 허용)
 *   - 가격엔진.현재가(코인키)        : 해당 코인 마지막 가격(number) 반환, 없으면 null
 *   - 가격엔진.코인목록()           : [{키,심볼,스트림}] 반환
 *   - 가격엔진.상태구독(콜백)        : 연결상태 변화 시 콜백("연결"|"재연결"|"끊김")
 *   - 자동 재연결(지수 백오프) 포함
 *
 * 순수 바닐라 JS. 외부 라이브러리 의존성 0. API 키 불필요.
 */
(function (전역) {
  'use strict';

  // ===== 코인 정의 (키=한국어, 스트림=바이낸스 소문자, 심볼=REST 대문자) =====
  var 코인들 = [
    { 키: '비트코인', 스트림: 'btcusdt', 심볼: 'BTCUSDT' },
    { 키: '이더리움', 스트림: 'ethusdt', 심볼: 'ETHUSDT' }
  ];
  // 스트림명 → 코인키 빠른 조회
  var 스트림에서키 = {};
  코인들.forEach(function (c) { 스트림에서키[c.스트림] = c.키; });

  // ===== 설정 상수 =====
  var WS_주소 = 'wss://stream.binance.com:9443/stream?streams=' +
    코인들.map(function (c) { return c.스트림 + '@trade'; }).join('/');
  var REST_주소 = 'https://api.binance.com/api/v3/ticker/price?symbols=' +
    encodeURIComponent(JSON.stringify(코인들.map(function (c) { return c.심볼; })));
  var 심볼에서키 = {};
  코인들.forEach(function (c) { 심볼에서키[c.심볼] = c.키; });

  var REST_폴링간격_ms = 3000;
  var 백오프_최소_ms = 1000;
  var 백오프_최대_ms = 30000;

  // ===== 내부 상태 =====
  var 소켓 = null;
  var 마지막가격 = {};              // { 코인키: 가격(number) }
  var 가격구독자 = [];
  var 상태구독자 = [];
  var 현재상태 = null;
  var 재연결횟수 = 0;
  var 재연결타이머 = null;
  var REST타이머 = null;
  var 실행중 = false;
  var 한번이라도연결됨 = false;

  function WS생성자() {
    return (typeof WebSocket !== 'undefined') ? WebSocket
         : (전역 && 전역.WebSocket) ? 전역.WebSocket : null;
  }

  function 가격통지(코인키, 가격) {
    for (var i = 0; i < 가격구독자.length; i++) {
      try { 가격구독자[i](코인키, 가격); }
      catch (e) { console.error('[가격엔진] 가격 구독자 콜백 오류:', e); }
    }
  }

  function 상태통지(상태) {
    if (상태 === 현재상태) return;
    현재상태 = 상태;
    for (var i = 0; i < 상태구독자.length; i++) {
      try { 상태구독자[i](상태); }
      catch (e) { console.error('[가격엔진] 상태 구독자 콜백 오류:', e); }
    }
  }

  // 코인키 + 원시값(문자열/숫자) → 파싱·저장·통지
  function 가격수신(코인키, 원시값) {
    if (!코인키) return;
    var 가격 = parseFloat(원시값);
    if (!isFinite(가격)) return;
    마지막가격[코인키] = 가격;
    가격통지(코인키, 가격);
  }

  // ===== WebSocket 연결 =====
  function 웹소켓연결() {
    var Ctor = WS생성자();
    if (!Ctor) {
      console.warn('[가격엔진] WebSocket 미지원 환경 → REST 폴백 사용');
      REST폴백시작();
      return;
    }

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
      재연결횟수 = 0;
      REST폴백중지();
      상태통지('연결');
      console.log('[가격엔진] 바이낸스 통합 WebSocket 연결됨');
    };

    소켓.onmessage = function (이벤트) {
      try {
        var 메시지 = JSON.parse(이벤트.data);
        // 통합 스트림 형식: { stream:"btcusdt@trade", data:{ p:"...", ... } }
        var data = 메시지 && 메시지.data ? 메시지.data : 메시지;
        var 스트림 = 메시지 && 메시지.stream ? 메시지.stream.split('@')[0] : null;
        var 코인키 = 스트림 ? 스트림에서키[스트림] : null;
        if (코인키 && data && data.p !== undefined) {
          가격수신(코인키, data.p);
        }
      } catch (e) {
        console.error('[가격엔진] 메시지 파싱 오류:', e);
      }
    };

    소켓.onerror = function (오류) {
      console.warn('[가격엔진] WebSocket 오류:', 오류 && 오류.message ? 오류.message : 오류);
    };

    소켓.onclose = function () {
      console.warn('[가격엔진] WebSocket 연결 종료됨');
      연결끊김처리();
    };
  }

  function 연결끊김처리() {
    소켓 = null;
    if (!실행중) return;
    상태통지('끊김');
    REST폴백시작();
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
    if (REST타이머) return;
    console.log('[가격엔진] REST 폴백 폴링 시작(3초 간격)');
    REST폴링1회();
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
        // symbols 배열 조회 응답: [{symbol:"BTCUSDT",price:"..."}, ...]
        if (Array.isArray(데이터)) {
          데이터.forEach(function (항목) {
            var 코인키 = 심볼에서키[항목 && 항목.symbol];
            if (코인키 && 항목.price !== undefined) 가격수신(코인키, 항목.price);
          });
        } else if (데이터 && 데이터.symbol && 데이터.price !== undefined) {
          var k = 심볼에서키[데이터.symbol];
          if (k) 가격수신(k, 데이터.price);
        }
      })
      .catch(function (e) {
        console.warn('[가격엔진] REST 폴링 실패:', e && e.message ? e.message : e);
      });
  }

  // ===== 공개 API =====
  var 가격엔진 = {
    시작: function () {
      if (실행중) { console.warn('[가격엔진] 이미 실행 중입니다'); return; }
      실행중 = true;
      재연결횟수 = 0;
      한번이라도연결됨 = false;
      웹소켓연결();
    },

    // 새 가격마다 콜백(코인키, 가격숫자USD). 늦게 구독해도 이미 받은 가격 즉시 1회 전달.
    구독: function (콜백) {
      if (typeof 콜백 === 'function') {
        가격구독자.push(콜백);
        Object.keys(마지막가격).forEach(function (키) {
          try { 콜백(키, 마지막가격[키]); } catch (e) { /* 무시 */ }
        });
      }
    },

    현재가: function (코인키) {
      return (코인키 in 마지막가격) ? 마지막가격[코인키] : null;
    },

    코인목록: function () {
      return 코인들.map(function (c) { return { 키: c.키, 심볼: c.심볼, 스트림: c.스트림 }; });
    },

    상태구독: function (콜백) {
      if (typeof 콜백 === 'function') {
        상태구독자.push(콜백);
        if (현재상태 !== null) {
          try { 콜백(현재상태); } catch (e) { /* 무시 */ }
        }
      }
    },

    정지: function () {
      실행중 = false;
      if (재연결타이머) { clearTimeout(재연결타이머); 재연결타이머 = null; }
      REST폴백중지();
      if (소켓) {
        try { 소켓.onclose = null; 소켓.close(); } catch (e) { /* 무시 */ }
        소켓 = null;
      }
    },

    // ----- 테스트 전용 훅(자가검증용) -----
    _모의메시지주입: function (코인키, 가격) {
      가격수신(코인키, 가격);
    }
  };

  전역.가격엔진 = 가격엔진;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = 가격엔진;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
