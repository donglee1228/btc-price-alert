// 서비스워커.js — PWA 앱셸 캐시
// 핵심: 정적 앱셸은 캐시(오프라인 설치), 가격 API 요청은 캐시 우회(항상 최신).
// 의존성 0.

// 캐시 버전: 앱 코드 바뀔 때마다 숫자를 올리면 옛 캐시가 자동 폐기된다.
var 캐시이름 = '코인-가격알림-v3';

// 앱셸: 오프라인에서도 떠야 하는 정적 자원
var 앱셸 = [
  './',
  './index.html',
  './화면.css',
  './앱.js',
  './가격엔진.js',
  './알림기.js',
  './manifest.json',
  './아이콘/아이콘-192.png',
  './아이콘/아이콘-512.png'
];

// install: 앱셸 미리 캐시
self.addEventListener('install', function (e) {
  self.skipWaiting(); // 새 버전 즉시 활성화
  e.waitUntil(
    caches.open(캐시이름).then(function (캐시) {
      // 일부 파일(가격엔진/알림기)이 아직 없을 수 있으니 개별 add로 실패 허용
      return Promise.all(앱셸.map(function (경로) {
        return 캐시.add(경로).catch(function (err) {
          console.warn('캐시 추가 실패(무시):', 경로, err && err.message);
        });
      }));
    })
  );
});

// activate: 옛 캐시 정리
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (키들) {
      return Promise.all(키들.map(function (키) {
        if (키 !== 캐시이름) return caches.delete(키);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// 가격 API 호스트인지 판별 — 이 요청들은 절대 캐시하지 않는다(passthrough).
function 가격API요청인가(요청) {
  try {
    var u = new URL(요청.url);
    // 바이낸스 REST/WS 및 모든 외부 API는 네트워크로 직행
    if (u.hostname.indexOf('binance.com') !== -1) return true;
    // 우리 origin이 아닌 외부 요청은 캐시 우회
    if (u.origin !== self.location.origin) return true;
    return false;
  } catch (e) {
    return true; // 파싱 불가 시 안전하게 우회
  }
}

// fetch: 동일출처 앱셸은 network-first(온라인이면 항상 최신, 받아오면 캐시 갱신),
//        오프라인일 때만 캐시로 폴백. 가격 API/외부는 손대지 않고 통과.
// → 새로 배포하면 앱을 다시 열기만 해도 최신이 뜬다(옛 화면 박제 방지).
self.addEventListener('fetch', function (e) {
  var 요청 = e.request;

  if (요청.method !== 'GET') return;

  if (가격API요청인가(요청)) {
    return; // 기본 네트워크 동작에 맡김 (캐시 우회)
  }

  e.respondWith(
    fetch(요청).then(function (응답) {
      // 정상 동일출처 응답이면 캐시 갱신해두고 그대로 반환
      if (응답 && 응답.status === 200 && 응답.type === 'basic') {
        var 복제 = 응답.clone();
        caches.open(캐시이름).then(function (캐시) { 캐시.put(요청, 복제); });
      }
      return 응답;
    }).catch(function () {
      // 오프라인 → 캐시 폴백, 네비게이션은 index.html로
      return caches.match(요청).then(function (캐시응답) {
        return 캐시응답 || (요청.mode === 'navigate' ? caches.match('./index.html') : undefined);
      });
    })
  );
});
