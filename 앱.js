// 앱.js — 글루코드 (멀티코인 표시 / 비트코인만 알림)
// 역할: 가격엔진 구독 → 코인별 화면갱신 → (ON 감시중일 때 비트코인만) 알림기.가격입력 호출,
//        연결상태 표시, ON/OFF 토글 버튼 핸들러.
// 정책: 비트코인 = ON 누른 순간 가격 기준 ±$500 알림.  이더리움 = 가격 표시 전용(알림 없음).
// 의존성 0.
(function () {
  'use strict';

  var 알림코인 = '비트코인'; // 알림 대상은 비트코인 하나뿐

  // ── DOM 요소 캐시 ──────────────────────────────────────────────────
  var 현재가엘 = {};   // { 코인키: element }
  var 직전가격 = {};   // { 코인키: 가격 } (오름/내림 색 표시용)
  var 연결상태엘 = null;
  var 다음경계엘 = null; // 비트코인 경계 표시
  var ON버튼 = null;
  var 안내엘 = null;

  var 감시중 = false;  // ON 눌러 비트코인 감시 시작했는지

  // 숫자를 USD 통화 문자열로 (예: 67300 → $67,300)
  function 통화(숫자, 소수자리) {
    if (숫자 == null || isNaN(숫자)) return '—';
    return '$' + Number(숫자).toLocaleString('en-US', {
      minimumFractionDigits: 소수자리 || 0,
      maximumFractionDigits: 소수자리 || 0
    });
  }

  // ── 코인별 화면 갱신 ────────────────────────────────────────────────
  function 화면갱신(코인키, 가격) {
    if (가격 == null || isNaN(가격)) return;
    var 엘 = 현재가엘[코인키];
    if (엘) {
      엘.textContent = 통화(가격, 2);
      var 이전 = 직전가격[코인키];
      if (이전 != null) {
        엘.classList.remove('오름', '내림');
        if (가격 > 이전) 엘.classList.add('오름');
        else if (가격 < 이전) 엘.classList.add('내림');
      }
    }
    // 비트코인은 감시중이면 경계도 갱신
    if (코인키 === 알림코인) 경계표시갱신(가격);
    직전가격[코인키] = 가격;
  }

  // 비트코인 경계 표시: 감시중이면 앵커 ±$500, 아니면 안내문
  function 경계표시갱신(가격) {
    if (!다음경계엘) return;
    if (감시중 && window.알림기 && typeof window.알림기.다음경계 === 'function' && 가격 != null) {
      var 경계 = window.알림기.다음경계(가격);
      if (경계) {
        다음경계엘.textContent = '▲ ' + 통화(경계.상방, 0) + '   ▼ ' + 통화(경계.하방, 0);
        return;
      }
    }
    다음경계엘.textContent = 감시중 ? '—' : 'ON을 누르면 시작';
  }

  // ── 연결상태 표시 ──────────────────────────────────────────────────
  function 상태갱신(상태) {
    if (!연결상태엘) return;
    연결상태엘.setAttribute('data-상태', 상태);
    var 텍스트 = { '연결': '실시간 연결됨', '재연결': '재연결 중…', '끊김': '연결 끊김' };
    연결상태엘.title = 텍스트[상태] || 상태;
  }

  // ── ON 버튼 표시 동기화 ─────────────────────────────────────────────
  function 버튼갱신() {
    if (!ON버튼) return;
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      ON버튼.textContent = '알림 차단됨 (브라우저 설정에서 허용)';
      ON버튼.disabled = true;
      ON버튼.classList.remove('켜짐');
      return;
    }
    ON버튼.disabled = false;
    if (감시중) {
      ON버튼.textContent = '■ 비트코인 감시 중 (누르면 끄기)';
      ON버튼.classList.add('켜짐');
    } else {
      ON버튼.textContent = '▶ 비트코인 알림 ON';
      ON버튼.classList.remove('켜짐');
    }
  }

  // ── ON/OFF 토글 ────────────────────────────────────────────────────
  function 감시켜기() {
    var 현재가 = (window.가격엔진 && typeof window.가격엔진.현재가 === 'function')
      ? window.가격엔진.현재가(알림코인) : null;
    if (현재가 == null || isNaN(현재가)) {
      if (안내엘) 안내엘.textContent = '비트코인 가격 수신 대기 중… 잠시 후 다시 눌러주세요';
      return;
    }
    if (window.알림기 && typeof window.알림기.앵커설정 === 'function') {
      window.알림기.앵커설정(현재가); // 이 순간 비트코인 가격이 기준점
    }
    감시중 = true;
    버튼갱신();
    경계표시갱신(현재가);
    if (안내엘) 안내엘.textContent = '기준 ' + 통화(현재가, 0) + ' 에서 $500 움직이면 알림';
  }

  function 감시끄기() {
    감시중 = false;
    버튼갱신();
    경계표시갱신(직전가격[알림코인]);
    if (안내엘) 안내엘.textContent = 'ON을 누른 순간 비트코인 가격에서 $500 움직이면 알려드려요';
  }

  function ON핸들러() {
    if (감시중) { 감시끄기(); return; }

    if (typeof Notification === 'undefined') {
      if (안내엘) 안내엘.textContent = '이 브라우저는 알림을 지원하지 않습니다';
      return;
    }
    if (Notification.permission === 'granted') { 감시켜기(); return; }

    var 요청 = (window.알림기 && typeof window.알림기.권한요청 === 'function')
      ? window.알림기.권한요청()
      : Notification.requestPermission().then(function (p) { return p === 'granted'; });

    Promise.resolve(요청).then(function (허용) {
      버튼갱신();
      if (허용) 감시켜기();
      else if (안내엘) 안내엘.textContent = '알림 권한을 허용해야 알림을 받을 수 있어요';
    }).catch(function (e) {
      console.warn('권한요청 실패:', e);
      버튼갱신();
    });
  }

  // ── 초기화 ──────────────────────────────────────────────────────────
  function 초기화() {
    현재가엘['비트코인'] = document.getElementById('현재가-비트코인');
    현재가엘['이더리움'] = document.getElementById('현재가-이더리움');
    연결상태엘 = document.getElementById('연결상태');
    다음경계엘 = document.getElementById('다음경계-비트코인');
    ON버튼 = document.getElementById('알림권한버튼');
    안내엘 = document.getElementById('안내');

    버튼갱신();
    경계표시갱신(null);
    if (ON버튼) ON버튼.addEventListener('click', ON핸들러);

    if (window.가격엔진) {
      try {
        if (typeof window.가격엔진.구독 === 'function') {
          window.가격엔진.구독(function (코인키, 가격) {
            화면갱신(코인키, 가격);
            // 알림은 비트코인 + 감시중일 때만
            if (감시중 && 코인키 === 알림코인 &&
                window.알림기 && typeof window.알림기.가격입력 === 'function') {
              window.알림기.가격입력(가격);
            }
          });
        }
        if (typeof window.가격엔진.상태구독 === 'function') {
          window.가격엔진.상태구독(상태갱신);
        }
        if (typeof window.가격엔진.시작 === 'function') {
          window.가격엔진.시작();
        }
      } catch (e) {
        console.warn('가격엔진 연동 실패:', e);
      }
    } else {
      console.warn('가격엔진 파일 없음 — 가격 표시 대기 중');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', 초기화);
  } else {
    초기화();
  }
})();
