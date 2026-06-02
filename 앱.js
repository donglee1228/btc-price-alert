// 앱.js — 글루코드
// 역할: 가격엔진 구독 → 화면갱신 → (ON 감시중일 때만) 알림기.가격입력 호출,
//        연결상태 표시, ON/OFF 토글 버튼 핸들러.
// 동작 요구: ON 누른 "그 순간 가격"을 기준점으로 잡고, 거기서 위/아래로 $300 움직이면 알림.
// 의존성 0.
(function () {
  'use strict';

  // ── DOM 요소 캐시 ──────────────────────────────────────────────────
  var 현재가엘 = null;
  var 연결상태엘 = null;
  var 다음경계엘 = null;
  var 다음경계라벨엘 = null;
  var ON버튼 = null;
  var 안내엘 = null;

  var 직전가격 = null; // 색(오름/내림) 표시용
  var 감시중 = false;  // ON 눌러 감시 시작했는지 여부

  // 숫자를 USD 통화 문자열로 (예: 67300 → $67,300)
  function 통화(숫자, 소수자리) {
    if (숫자 == null || isNaN(숫자)) return '—';
    return '$' + Number(숫자).toLocaleString('en-US', {
      minimumFractionDigits: 소수자리 || 0,
      maximumFractionDigits: 소수자리 || 0
    });
  }

  // ── 화면 갱신: 현재가 + (감시중이면) 다음 경계 ──────────────────────
  function 화면갱신(가격) {
    if (가격 == null || isNaN(가격)) return;

    if (현재가엘) {
      현재가엘.textContent = 통화(가격, 2);
      if (직전가격 != null) {
        현재가엘.classList.remove('오름', '내림');
        if (가격 > 직전가격) 현재가엘.classList.add('오름');
        else if (가격 < 직전가격) 현재가엘.classList.add('내림');
      }
    }

    경계표시갱신(가격);
    직전가격 = 가격;
  }

  // 감시중이면 앵커 기준 상/하 경계를, 아니면 안내문을 표시
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

  // ── 연결상태 표시: "연결" | "재연결" | "끊김" ───────────────────────
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
      ON버튼.textContent = '■ 감시 중 (누르면 끄기)';
      ON버튼.classList.add('켜짐');
    } else {
      ON버튼.textContent = '▶ 알림 ON';
      ON버튼.classList.remove('켜짐');
    }
  }

  // ── ON/OFF 토글 ────────────────────────────────────────────────────
  function 감시켜기() {
    var 현재가 = (window.가격엔진 && typeof window.가격엔진.현재가 === 'function')
      ? window.가격엔진.현재가() : null;
    if (현재가 == null || isNaN(현재가)) {
      if (안내엘) 안내엘.textContent = '가격 수신 대기 중… 잠시 후 다시 눌러주세요';
      return;
    }
    if (window.알림기 && typeof window.알림기.앵커설정 === 'function') {
      window.알림기.앵커설정(현재가); // 이 순간 가격이 기준점
    }
    감시중 = true;
    버튼갱신();
    경계표시갱신(현재가);
    if (안내엘) 안내엘.textContent = '기준 ' + 통화(현재가, 0) + ' 에서 $300 움직이면 알림';
  }

  function 감시끄기() {
    감시중 = false;
    버튼갱신();
    경계표시갱신(직전가격);
    if (안내엘) 안내엘.textContent = 'ON을 누른 순간 가격에서 $300 움직이면 알려드려요';
  }

  // ON 버튼 클릭: (필요시) 권한요청 → 권한 있으면 감시 시작/중지 토글
  function ON핸들러() {
    if (감시중) { 감시끄기(); return; }

    // 권한이 이미 있으면 바로 시작
    if (typeof Notification === 'undefined') {
      // 알림 미지원이어도 화면 감시는 의미가 없으니 안내만
      if (안내엘) 안내엘.textContent = '이 브라우저는 알림을 지원하지 않습니다';
      return;
    }
    if (Notification.permission === 'granted') { 감시켜기(); return; }

    // default 상태 → 사용자 제스처(이 클릭)로 권한 요청
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
    현재가엘 = document.getElementById('현재가');
    연결상태엘 = document.getElementById('연결상태');
    다음경계엘 = document.getElementById('다음경계');
    다음경계라벨엘 = document.getElementById('다음경계라벨');
    ON버튼 = document.getElementById('알림권한버튼');
    안내엘 = document.getElementById('안내');

    버튼갱신();
    경계표시갱신(null);
    if (ON버튼) ON버튼.addEventListener('click', ON핸들러);

    if (window.가격엔진) {
      try {
        if (typeof window.가격엔진.구독 === 'function') {
          window.가격엔진.구독(function (가격) {
            화면갱신(가격);
            // 감시중일 때만 알림 판정에 가격 투입
            if (감시중 && window.알림기 && typeof window.알림기.가격입력 === 'function') {
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
