// 전역 상태
const state = {
  places: [],
  toilets: [],
  selectedPlace: null,
  map: null,
  markers: [],
  toiletMarkers: [],
  infoWindow: null
};

// API 설정
const config = {
  googleApiKey: localStorage.getItem('googleApiKey') || '',
  naverClientId: localStorage.getItem('naverClientId') || '',
  naverClientSecret: localStorage.getItem('naverClientSecret') || '',
  kakaoApiKey: localStorage.getItem('kakaoApiKey') || ''
};

// DOM 로드 완료 시 초기화
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  // 이벤트 리스너 설정
  setupEventListeners();

  // API 키 확인 및 지도 로드
  if (config.googleApiKey) {
    loadGoogleMaps();
  } else {
    showApiGuideModal();
  }

  // 저장된 장소 데이터 자동 로드
  loadSavedPlacesData();

  // 저장된 화장실 데이터 자동 로드
  loadSavedToiletData();
}

function setupEventListeners() {
  // 설정 버튼
  document.getElementById('settingsBtn').addEventListener('click', () => {
    showSettingsModal();
  });

  // KML 파일 업로드
  document.getElementById('kmlFileInput').addEventListener('change', handleKmlFileUpload);

  // Google Takeout JSON 업로드
  document.getElementById('takeoutFileInput').addEventListener('change', handleTakeoutFileUpload);

  // KML URL 불러오기
  document.getElementById('loadUrlBtn').addEventListener('click', handleKmlUrlLoad);

  // 화장실 데이터 업로드
  document.getElementById('toiletFileInput').addEventListener('change', handleToiletFileUpload);

  // 화장실 데이터 초기화
  document.getElementById('resetToiletBtn').addEventListener('click', resetToiletData);

  // 장소 데이터 초기화
  document.getElementById('resetPlacesBtn').addEventListener('click', resetPlacesData);

  // 장소 검색
  document.getElementById('placeSearch').addEventListener('input', filterPlaces);

  // 탭 전환
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => switchTab(e.target.dataset.tab));
  });

  // 화장실 반경 변경
  document.getElementById('toiletRadius').addEventListener('change', () => {
    if (state.selectedPlace) {
      searchNearbyToilets(state.selectedPlace);
    }
  });

  // 후기 검색
  document.getElementById('searchReviewBtn').addEventListener('click', searchReviews);

  // 모달 닫기
  document.querySelectorAll('.modal-close, .modal-close-btn').forEach(btn => {
    btn.addEventListener('click', closeAllModals);
  });

  // 설정 저장
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);

  // 설정으로 이동
  document.getElementById('goToSettingsBtn').addEventListener('click', () => {
    closeAllModals();
    showSettingsModal();
  });

  // API 키 표시/숨기기 토글
  document.querySelectorAll('.btn-toggle-visibility').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (input.type === 'password') {
        input.type = 'text';
        btn.classList.add('active');
        btn.textContent = '🙈';
      } else {
        input.type = 'password';
        btn.classList.remove('active');
        btn.textContent = '👁️';
      }
    });
  });
}

// ============================================
// Google Maps 관련
// ============================================
function loadGoogleMaps() {
  if (!config.googleApiKey) {
    document.getElementById('map').innerHTML = '<div class="empty-message">Google Maps API 키를 설정해주세요</div>';
    return;
  }

  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${config.googleApiKey}&callback=initMap`;
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

window.initMap = function() {
  // 기본 위치: 대한민국 중심
  const defaultCenter = { lat: 36.5, lng: 127.5 };

  state.map = new google.maps.Map(document.getElementById('map'), {
    zoom: 7,
    center: defaultCenter,
    styles: [
      { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }
    ]
  });

  state.infoWindow = new google.maps.InfoWindow();

  // 저장된 장소 데이터가 있으면 마커 추가
  if (state.places.length > 0) {
    addPlaceMarkers();
  }

  // 콜백이 설정되어 있으면 실행
  if (window.onMapLoaded) {
    window.onMapLoaded();
    window.onMapLoaded = null;
  }
};

function addPlaceMarkers() {
  // 기존 마커 제거
  state.markers.forEach(marker => marker.setMap(null));
  state.markers = [];

  const bounds = new google.maps.LatLngBounds();

  state.places.forEach((place, index) => {
    const marker = new google.maps.Marker({
      position: { lat: place.coordinates.lat, lng: place.coordinates.lng },
      map: state.map,
      title: place.name,
      icon: {
        url: 'data:image/svg+xml,' + encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40">
            <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 25 15 25s15-14.5 15-25C30 6.7 23.3 0 15 0z" fill="#3498db"/>
            <circle cx="15" cy="15" r="8" fill="white"/>
            <text x="15" y="19" text-anchor="middle" font-size="10" fill="#3498db">${index + 1}</text>
          </svg>
        `),
        scaledSize: new google.maps.Size(30, 40)
      }
    });

    marker.addListener('click', () => {
      selectPlace(place, index);
    });

    state.markers.push(marker);
    bounds.extend(marker.getPosition());
  });

  if (state.places.length > 0) {
    state.map.fitBounds(bounds);
    if (state.places.length === 1) {
      state.map.setZoom(14);
    }
  }
}

function addToiletMarkers(toilets) {
  // 기존 화장실 마커 제거
  state.toiletMarkers.forEach(marker => marker.setMap(null));
  state.toiletMarkers = [];

  toilets.forEach(toilet => {
    const marker = new google.maps.Marker({
      position: { lat: toilet.lat, lng: toilet.lng },
      map: state.map,
      title: toilet.name,
      icon: {
        url: 'data:image/svg+xml,' + encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" fill="#4caf50"/>
            <text x="12" y="16" text-anchor="middle" font-size="12" fill="white">🚽</text>
          </svg>
        `),
        scaledSize: new google.maps.Size(24, 24)
      }
    });

    marker.addListener('click', () => {
      const content = `
        <div style="max-width: 250px;">
          <h4 style="margin: 0 0 8px;">${toilet.name}</h4>
          <p style="font-size: 12px; color: #666; margin: 0;">${toilet.address}</p>
          <p style="font-size: 12px; margin: 4px 0;">거리: ${toilet.distance}m</p>
        </div>
      `;
      state.infoWindow.setContent(content);
      state.infoWindow.open(state.map, marker);
    });

    state.toiletMarkers.push(marker);
  });
}

// ============================================
// KML 파일 처리
// ============================================
async function handleKmlFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    showLoading('placesList');
    const response = await fetch('/api/parse-kml', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    if (data.success) {
      // Geocoding 필요한 장소 확인
      const placesNeedGeocode = data.places.filter(p => p.needsGeocode && p.address);

      if (placesNeedGeocode.length > 0) {
        // Geocoding 진행
        const geocodedPlaces = await geocodePlaces(data.places);
        state.places = geocodedPlaces;
      } else {
        state.places = data.places;
      }

      // 좌표가 있는 장소만 필터링
      const validPlaces = state.places.filter(p => p.coordinates && p.coordinates.lat && p.coordinates.lng);
      state.places = validPlaces;

      renderPlacesList();
      addPlaceMarkers();

      // 서버에 저장 및 UI 업데이트
      await savePlacesData(validPlaces, `KML: ${file.name}`);

      // Geocoding 실패한 장소가 있으면 알림
      const failedCount = data.places.length - validPlaces.length;
      if (failedCount > 0) {
        alert(`${data.places.length}개 중 ${validPlaces.length}개 장소를 로드했습니다.\n(${failedCount}개는 좌표를 찾을 수 없습니다)`);
      }
    } else {
      alert(data.error);
    }
  } catch (error) {
    alert('파일 처리 중 오류가 발생했습니다.');
    console.error(error);
  }
}

async function handleKmlUrlLoad() {
  const url = document.getElementById('kmlUrlInput').value.trim();
  if (!url) {
    alert('URL을 입력해주세요.');
    return;
  }

  try {
    showLoading('placesList');
    const response = await fetch('/api/parse-kml-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await response.json();
    if (data.success) {
      // Geocoding 필요한 장소 확인
      const placesNeedGeocode = data.places.filter(p => p.needsGeocode && p.address);

      if (placesNeedGeocode.length > 0) {
        // Geocoding 진행
        const geocodedPlaces = await geocodePlaces(data.places);
        state.places = geocodedPlaces;
      } else {
        state.places = data.places;
      }

      // 좌표가 있는 장소만 필터링
      const validPlaces = state.places.filter(p => p.coordinates && p.coordinates.lat && p.coordinates.lng);
      state.places = validPlaces;

      renderPlacesList();
      addPlaceMarkers();

      // 서버에 저장 및 UI 업데이트
      await savePlacesData(validPlaces, `URL: Google My Maps`);

      // Geocoding 실패한 장소가 있으면 알림
      const failedCount = data.places.length - validPlaces.length;
      if (failedCount > 0) {
        alert(`${data.places.length}개 중 ${validPlaces.length}개 장소를 로드했습니다.\n(${failedCount}개는 좌표를 찾을 수 없습니다)`);
      }
    } else {
      alert(data.error);
    }
  } catch (error) {
    alert('URL에서 데이터를 가져오는 중 오류가 발생했습니다.');
    console.error(error);
  }
}

// ============================================
// Google Takeout 처리 (CSV/JSON)
// ============================================
async function handleTakeoutFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    showLoading('placesList');
    document.getElementById('placesList').innerHTML = '<div class="loading"></div><p style="text-align:center;margin-top:1rem;">파일 파싱 중...</p>';

    const response = await fetch('/api/parse-takeout', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    if (data.success) {
      let places = data.places;

      // 1단계: Kakao 지오코딩 먼저 시도 (빠름)
      const placesNeedGeocode = places.filter(p => !p.coordinates && (p.address || p.name));
      if (placesNeedGeocode.length > 0 && config.kakaoApiKey) {
        document.getElementById('placesList').innerHTML =
          `<div class="loading"></div><p style="text-align:center;margin-top:1rem;">Kakao 지오코딩 중... (${placesNeedGeocode.length}개)</p>`;

        places = await geocodePlaces(places);
      }

      // 2단계: 아직 좌표가 없는 장소만 URL에서 좌표 추출 (느림)
      const placesNeedUrlExtract = places.filter(p => p.url && !p.coordinates);
      if (placesNeedUrlExtract.length > 0) {
        const BATCH_SIZE = 20;
        let totalSuccess = 0;
        let totalFail = 0;

        // 좌표가 없는 장소의 인덱스 목록
        const needUrlIndices = places.map((p, idx) => (p.url && !p.coordinates) ? idx : -1).filter(i => i >= 0);

        for (let i = 0; i < needUrlIndices.length; i += BATCH_SIZE) {
          const batchIndices = needUrlIndices.slice(i, i + BATCH_SIZE);
          const batch = batchIndices.map(idx => places[idx]);
          const progress = Math.min(i + BATCH_SIZE, needUrlIndices.length);

          document.getElementById('placesList').innerHTML =
            `<div class="loading"></div><p style="text-align:center;margin-top:1rem;">URL에서 좌표 추출 중... (${progress}/${needUrlIndices.length}개 미변환 장소)</p>`;

          try {
            const urlResponse = await fetch('/api/extract-coords-batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ places: batch })
            });

            const urlData = await urlResponse.json();
            if (urlData.success) {
              // 결과를 원래 배열에 병합
              urlData.places.forEach((p, batchIdx) => {
                places[batchIndices[batchIdx]] = p;
              });
              totalSuccess += urlData.successCount;
              totalFail += urlData.failCount;
            }
          } catch (err) {
            console.error(`배치 ${i}-${i + BATCH_SIZE} 실패:`, err);
          }
        }

        console.log(`URL 좌표 추출 완료: ${totalSuccess}개 성공, ${totalFail}개 실패`);
      }

      state.places = places;

      // 좌표가 있는 장소만 필터링
      const validPlaces = state.places.filter(p => p.coordinates && p.coordinates.lat && p.coordinates.lng);
      state.places = validPlaces;

      renderPlacesList();
      addPlaceMarkers();

      // 서버에 저장 및 UI 업데이트
      await savePlacesData(validPlaces, `Takeout: ${file.name}`);

      // 결과 알림
      const failedCount = data.places.length - validPlaces.length;
      if (failedCount > 0) {
        alert(`${data.places.length}개 중 ${validPlaces.length}개 장소를 로드했습니다.\n(${failedCount}개는 좌표를 찾을 수 없습니다)`);
      } else {
        alert(`${validPlaces.length}개 장소를 모두 로드했습니다.`);
      }
    } else {
      alert(data.error);
    }
  } catch (error) {
    alert('파일 처리 중 오류가 발생했습니다.');
    console.error(error);
  }
}

// ============================================
// 장소 데이터 저장/로드
// ============================================

// 저장된 장소 데이터 자동 로드
async function loadSavedPlacesData() {
  try {
    const response = await fetch('/api/places');
    const data = await response.json();

    if (data.success && data.places && data.places.length > 0) {
      state.places = data.places;
      renderPlacesList();

      // 지도가 로드되면 마커 추가
      if (state.map) {
        addPlaceMarkers();
      } else {
        // 지도 로드 후 마커 추가를 위한 콜백 설정
        window.onMapLoaded = () => addPlaceMarkers();
      }

      updatePlacesInfoDisplay(data);
    }
  } catch (error) {
    console.error('저장된 장소 데이터 로드 실패:', error);
  }
}

// 장소 데이터 서버에 저장
async function savePlacesData(places, source) {
  try {
    const response = await fetch('/api/places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ places, source })
    });

    const data = await response.json();
    if (data.success) {
      updatePlacesInfoDisplay({
        count: data.count,
        source: source,
        lastUpdate: data.lastUpdate
      });
    }
  } catch (error) {
    console.error('장소 데이터 저장 실패:', error);
  }
}

// 장소 정보 UI 업데이트
function updatePlacesInfoDisplay(data) {
  const infoEl = document.getElementById('placesInfo');
  const countEl = document.getElementById('placesCount');
  const sourceEl = document.getElementById('placesSource');
  const updateEl = document.getElementById('placesUpdate');

  infoEl.classList.remove('hidden');
  countEl.textContent = `${data.count || data.places?.length || 0}개 장소 로드됨`;

  if (data.source) {
    sourceEl.textContent = `출처: ${data.source}`;
  }

  if (data.lastUpdate) {
    const updateDate = new Date(data.lastUpdate);
    updateEl.textContent = `업데이트: ${updateDate.toLocaleDateString('ko-KR')} ${updateDate.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
  }
}

// 장소 데이터 초기화
async function resetPlacesData() {
  if (!confirm('모든 장소 데이터를 삭제하시겠습니까?')) return;

  try {
    const response = await fetch('/api/places', { method: 'DELETE' });
    const data = await response.json();

    if (data.success) {
      state.places = [];

      // 마커 제거
      state.markers.forEach(marker => marker.setMap(null));
      state.markers = [];

      // UI 초기화
      document.getElementById('placesInfo').classList.add('hidden');
      document.getElementById('placesList').innerHTML = '<p class="empty-message">장소 데이터를 불러와주세요</p>';

      // 상세 패널 초기화
      document.getElementById('selectedPlaceName').textContent = '장소를 선택하세요';
      document.getElementById('selectedPlaceDesc').textContent = '';

      alert('장소 데이터가 초기화되었습니다.');
    }
  } catch (error) {
    console.error('장소 데이터 삭제 실패:', error);
    alert('삭제 중 오류가 발생했습니다.');
  }
}

// ============================================
// 화장실 데이터 처리
// ============================================

// 저장된 화장실 데이터 자동 로드
async function loadSavedToiletData() {
  try {
    const response = await fetch('/api/toilets');
    const data = await response.json();

    if (data.success && data.toilets && data.toilets.length > 0) {
      state.toilets = data.toilets;
      updateToiletInfoDisplay(data);
    }
  } catch (error) {
    console.error('화장실 데이터 로드 실패:', error);
  }
}

// 화장실 정보 표시 업데이트
function updateToiletInfoDisplay(data) {
  const infoContainer = document.getElementById('toiletInfo');
  const countEl = document.getElementById('toiletCount');
  const regionsEl = document.getElementById('toiletRegions');
  const updateEl = document.getElementById('toiletUpdate');

  countEl.textContent = `${data.count.toLocaleString()}개 화장실 데이터`;

  if (data.regions && data.regions.length > 0) {
    regionsEl.textContent = `지역: ${data.regions.join(', ')}`;
  } else {
    regionsEl.textContent = '';
  }

  if (data.lastUpdate) {
    const updateDate = new Date(data.lastUpdate);
    updateEl.textContent = `업데이트: ${updateDate.toLocaleDateString('ko-KR')} ${updateDate.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
  } else {
    updateEl.textContent = '';
  }

  infoContainer.classList.remove('hidden');
}

// 화장실 데이터 업로드 (누적)
async function handleToiletFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch('/api/parse-toilet', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    if (data.success) {
      state.toilets = data.toilets;
      updateToiletInfoDisplay(data);

      // 업로드 결과 알림
      alert(`${data.region} 지역 ${data.newCount.toLocaleString()}개 화장실 데이터가 추가되었습니다.\n총 ${data.count.toLocaleString()}개`);

      // 선택된 장소가 있으면 화장실 검색 실행
      if (state.selectedPlace) {
        searchNearbyToilets(state.selectedPlace);
      }
    } else {
      alert(data.error);
    }
  } catch (error) {
    alert('파일 처리 중 오류가 발생했습니다.');
    console.error(error);
  }

  // 파일 입력 초기화 (같은 파일 다시 선택 가능하도록)
  e.target.value = '';
}

// 화장실 데이터 초기화
async function resetToiletData() {
  if (!confirm('모든 화장실 데이터를 삭제하시겠습니까?')) {
    return;
  }

  try {
    const response = await fetch('/api/toilets', { method: 'DELETE' });
    const data = await response.json();

    if (data.success) {
      state.toilets = [];
      document.getElementById('toiletInfo').classList.add('hidden');
      alert('화장실 데이터가 초기화되었습니다.');
    }
  } catch (error) {
    alert('초기화 중 오류가 발생했습니다.');
    console.error(error);
  }
}

// ============================================
// 장소 목록
// ============================================
function renderPlacesList() {
  const container = document.getElementById('placesList');

  if (state.places.length === 0) {
    container.innerHTML = '<p class="empty-message">장소 데이터를 불러와주세요</p>';
    return;
  }

  container.innerHTML = state.places.map((place, index) => {
    // 목록에서는 <br> 제거하고 첫 줄만 표시
    const shortDesc = (place.description || '설명 없음')
      .replace(/<br\s*\/?>/gi, ' ')
      .substring(0, 50);
    return `
      <div class="place-item" data-index="${index}">
        <h4>${index + 1}. ${escapeHtml(place.name)}</h4>
        <p>${escapeHtml(shortDesc)}${shortDesc.length >= 50 ? '...' : ''}</p>
      </div>
    `;
  }).join('');

  // 클릭 이벤트 추가
  container.querySelectorAll('.place-item').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt(item.dataset.index);
      selectPlace(state.places[index], index);
    });
  });
}

function filterPlaces() {
  const keyword = document.getElementById('placeSearch').value.toLowerCase();
  const items = document.querySelectorAll('.place-item');

  items.forEach((item, index) => {
    const place = state.places[index];
    const match = place.name.toLowerCase().includes(keyword) ||
                  (place.description && place.description.toLowerCase().includes(keyword));
    item.style.display = match ? '' : 'none';
  });
}

function selectPlace(place, index) {
  state.selectedPlace = place;

  // 목록에서 활성화 표시
  document.querySelectorAll('.place-item').forEach((item, i) => {
    item.classList.toggle('active', i === index);
  });

  // 상세 패널 업데이트
  document.getElementById('selectedPlaceName').textContent = place.name;
  document.getElementById('selectedPlaceDesc').innerHTML = escapeHtmlKeepBr(place.description || '');

  // 지도 이동
  if (state.map) {
    state.map.panTo({ lat: place.coordinates.lat, lng: place.coordinates.lng });
    state.map.setZoom(14);

    // 인포윈도우 표시
    const content = `
      <div style="max-width: 250px;">
        <h4 style="margin: 0 0 8px;">${escapeHtml(place.name)}</h4>
        <p style="font-size: 12px; margin: 0; line-height: 1.5;">${escapeHtmlKeepBr(place.description || '')}</p>
      </div>
    `;
    state.infoWindow.setContent(content);
    state.infoWindow.setPosition({ lat: place.coordinates.lat, lng: place.coordinates.lng });
    state.infoWindow.open(state.map);
  }

  // 화장실 검색
  searchNearbyToilets(place);

  // 정보 탭 업데이트
  updatePlaceInfo(place);

  // 자동 후기 검색 (API 설정되어 있으면)
  autoSearchReviews();
}

// ============================================
// 화장실 검색
// ============================================
function searchNearbyToilets(place) {
  const container = document.getElementById('toiletResults');
  const radius = parseInt(document.getElementById('toiletRadius').value);

  if (state.toilets.length === 0) {
    container.innerHTML = '<p class="empty-message">화장실 데이터를 먼저 업로드해주세요</p>';
    return;
  }

  // 거리 계산 및 필터링
  const nearbyToilets = state.toilets.map(toilet => {
    const distance = calculateDistance(
      place.coordinates.lat, place.coordinates.lng,
      toilet.lat, toilet.lng
    );
    return { ...toilet, distance: Math.round(distance) };
  })
  .filter(toilet => toilet.distance <= radius)
  .sort((a, b) => a.distance - b.distance);

  if (nearbyToilets.length === 0) {
    container.innerHTML = `<p class="empty-message">${radius}m 내에 화장실이 없습니다</p>`;
    addToiletMarkers([]);
    return;
  }

  container.innerHTML = nearbyToilets.map(toilet => `
    <div class="result-item">
      <h4>🚽 ${escapeHtml(toilet.name)}</h4>
      <p>${escapeHtml(toilet.address)}</p>
      <span class="distance">${toilet.distance}m</span>
      <div class="toilet-detail">
        ${toilet.ownerType ? `<div class="detail-item">소유구분: <span>${escapeHtml(toilet.ownerType)}</span></div>` : ''}
        ${toilet.maleToilet ? `<div class="detail-item">남성 대변기: <span>${toilet.maleToilet}</span></div>` : ''}
        ${toilet.maleUrinal ? `<div class="detail-item">남성 소변기: <span>${toilet.maleUrinal}</span></div>` : ''}
        ${toilet.femaleToilet ? `<div class="detail-item">여성 대변기: <span>${toilet.femaleToilet}</span></div>` : ''}
        ${toilet.disabledToilet ? `<div class="detail-item">장애인용: <span>${toilet.disabledToilet}</span></div>` : ''}
        ${toilet.openTime ? `<div class="detail-item">운영시간: <span>${escapeHtml(toilet.openTime)}</span></div>` : ''}
        ${toilet.openTimeDetail ? `<div class="detail-item" style="grid-column: 1 / -1;">상세시간: <span>${escapeHtml(toilet.openTimeDetail)}</span></div>` : ''}
      </div>
    </div>
  `).join('');

  // 화장실 마커 추가
  addToiletMarkers(nearbyToilets);
}

// ============================================
// 네이버 검색
// ============================================
// 자동 후기 검색 (장소 선택 시 자동 호출, 알림 없음)
async function autoSearchReviews() {
  // API 설정이 없으면 조용히 스킵
  if (!state.selectedPlace || !config.naverClientId || !config.naverClientSecret) {
    return;
  }

  const additionalKeyword = document.getElementById('additionalKeyword').value.trim();
  const query = `${state.selectedPlace.name} ${additionalKeyword || '차박'}`;

  const container = document.getElementById('reviewResults');
  showLoading('reviewResults');

  // 분석 섹션 초기화
  document.getElementById('analysisSection').classList.add('hidden');

  try {
    const response = await fetch('/api/naver-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        clientId: config.naverClientId,
        clientSecret: config.naverClientSecret,
        type: 'blog'
      })
    });

    const data = await response.json();

    if (data.success) {
      displaySearchResults(data.items, data.analysis);
    } else {
      container.innerHTML = `<p class="empty-message">후기를 찾을 수 없습니다.</p>`;
    }
  } catch (error) {
    container.innerHTML = `<p class="empty-message">후기 검색 중 오류가 발생했습니다.</p>`;
    console.error(error);
  }
}

// 수동 후기 검색 (버튼 클릭 시)
async function searchReviews() {
  if (!state.selectedPlace) {
    alert('먼저 장소를 선택해주세요.');
    return;
  }

  if (!config.naverClientId || !config.naverClientSecret) {
    alert('네이버 API 설정이 필요합니다.');
    showSettingsModal();
    return;
  }

  const additionalKeyword = document.getElementById('additionalKeyword').value.trim();
  const query = `${state.selectedPlace.name} ${additionalKeyword || '차박'}`;

  const container = document.getElementById('reviewResults');
  showLoading('reviewResults');

  try {
    const response = await fetch('/api/naver-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        clientId: config.naverClientId,
        clientSecret: config.naverClientSecret,
        type: 'blog'
      })
    });

    const data = await response.json();

    if (data.success) {
      displaySearchResults(data.items, data.analysis);
    } else {
      container.innerHTML = `<p class="empty-message">검색 실패: ${data.error}</p>`;
    }
  } catch (error) {
    container.innerHTML = `<p class="empty-message">검색 중 오류가 발생했습니다.</p>`;
    console.error(error);
  }
}

function displaySearchResults(items, analysis) {
  // 분석 요약 표시
  const analysisSection = document.getElementById('analysisSection');
  const analysisSummary = document.getElementById('analysisSummary');
  const sentimentBadge = document.getElementById('sentimentBadge');
  const keywordTags = document.getElementById('keywordTags');

  if (analysis) {
    analysisSection.classList.remove('hidden');
    analysisSummary.textContent = analysis.summary;

    // 감성 배지
    const sentimentText = {
      positive: '😊 긍정적',
      negative: '😟 부정적',
      neutral: '😐 중립'
    };
    sentimentBadge.textContent = sentimentText[analysis.sentiment];
    sentimentBadge.className = `sentiment-badge ${analysis.sentiment}`;

    // 키워드 태그
    let tagsHtml = '';
    if (analysis.keywords.facilities) {
      tagsHtml += analysis.keywords.facilities.map(k =>
        `<span class="keyword-tag facility">${k.word}</span>`
      ).join('');
    }
    if (analysis.keywords.environment) {
      tagsHtml += analysis.keywords.environment.map(k =>
        `<span class="keyword-tag environment">${k.word}</span>`
      ).join('');
    }
    keywordTags.innerHTML = tagsHtml;
  }

  // 검색 결과 표시
  const container = document.getElementById('reviewResults');

  if (!items || items.length === 0) {
    container.innerHTML = '<p class="empty-message">검색 결과가 없습니다.</p>';
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="result-item">
      <h4><a href="${item.link}" target="_blank">${item.title}</a></h4>
      <p>${item.description}</p>
      <div class="meta">
        ${item.bloggername ? `<span>블로거: ${escapeHtml(item.bloggername)}</span>` : ''}
        ${item.postdate ? `<span> | ${formatDate(item.postdate)}</span>` : ''}
      </div>
    </div>
  `).join('');
}

// ============================================
// Geocoding (주소 → 좌표 변환)
// ============================================
async function geocodePlaces(places) {
  if (!config.kakaoApiKey) {
    alert('Kakao API 키가 필요합니다. 설정에서 입력해주세요.');
    showSettingsModal();
    return places;
  }

  // 좌표가 없고 이름이나 주소가 있는 장소를 필터링
  const placesNeedGeocode = places.filter(p => p.needsGeocode && (p.address || p.name));

  if (placesNeedGeocode.length === 0) {
    return places;
  }

  // 로딩 메시지 표시
  const container = document.getElementById('placesList');
  container.innerHTML = `<div class="loading"></div><p style="text-align:center;color:#666;">주소 → 좌표 변환 중... (${placesNeedGeocode.length}개)</p>`;

  try {
    const response = await fetch('/api/geocode-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        places: placesNeedGeocode,
        kakaoApiKey: config.kakaoApiKey
      })
    });

    const data = await response.json();

    if (data.success) {
      // 결과 병합 (서버는 data.places로 반환)
      const geocodedMap = new Map(data.places.map(r => [r.name, r]));

      return places.map(place => {
        if (place.needsGeocode && geocodedMap.has(place.name)) {
          const geocoded = geocodedMap.get(place.name);
          if (geocoded.coordinates) {
            return {
              ...place,
              coordinates: geocoded.coordinates,
              geocodedAddress: geocoded.geocodedAddress
            };
          }
        }
        return place;
      });
    } else {
      console.error('Geocoding failed:', data.error);
      return places;
    }
  } catch (error) {
    console.error('Geocoding error:', error);
    return places;
  }
}

// ============================================
// 유틸리티 함수
// ============================================
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // 지구 반경 (미터)
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function toRad(deg) {
  return deg * Math.PI / 180;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// HTML 이스케이프하되 <br> 태그는 유지
function escapeHtmlKeepBr(str) {
  if (!str) return '';
  // 먼저 <br>, <br/>, <br /> 태그를 임시 플레이스홀더로 변환
  const placeholder = '___BR_PLACEHOLDER___';
  const withPlaceholder = str.replace(/<br\s*\/?>/gi, placeholder);
  // HTML 이스케이프
  const escaped = escapeHtml(withPlaceholder);
  // 플레이스홀더를 <br>로 복원
  return escaped.replace(new RegExp(placeholder, 'g'), '<br>');
}

function formatDate(dateStr) {
  if (!dateStr || dateStr.length !== 8) return dateStr;
  return `${dateStr.substring(0,4)}.${dateStr.substring(4,6)}.${dateStr.substring(6,8)}`;
}

function showLoading(containerId) {
  document.getElementById(containerId).innerHTML = '<div class="loading"></div>';
}

// ============================================
// 탭 전환
// ============================================
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });

  document.getElementById(`${tabName}Tab`).classList.add('active');
}

// ============================================
// 장소 정보 업데이트
// ============================================
function updatePlaceInfo(place) {
  const container = document.getElementById('placeInfo');
  container.innerHTML = `
    <div class="info-row">
      <label>이름</label>
      <span>${escapeHtml(place.name)}</span>
    </div>
    <div class="info-row" style="flex-direction: column; align-items: flex-start;">
      <label>설명</label>
      <span style="margin-top: 0.3rem; line-height: 1.5;">${escapeHtmlKeepBr(place.description || '없음')}</span>
    </div>
    <div class="info-row">
      <label>위도</label>
      <span>${place.coordinates.lat.toFixed(6)}</span>
    </div>
    <div class="info-row">
      <label>경도</label>
      <span>${place.coordinates.lng.toFixed(6)}</span>
    </div>
    <div class="info-row">
      <label>네이버 지도</label>
      <span><a href="https://map.naver.com/v5/search/${encodeURIComponent(place.name)}" target="_blank">바로가기</a></span>
    </div>
    <div class="info-row">
      <label>카카오 지도</label>
      <span><a href="https://map.kakao.com/?q=${encodeURIComponent(place.name)}" target="_blank">바로가기</a></span>
    </div>
  `;
}

// ============================================
// 모달 관련
// ============================================
function showSettingsModal() {
  document.getElementById('settingsModal').classList.remove('hidden');

  // 기존 설정값 로드
  document.getElementById('googleApiKey').value = config.googleApiKey;
  document.getElementById('naverClientId').value = config.naverClientId;
  document.getElementById('naverClientSecret').value = config.naverClientSecret;
  document.getElementById('kakaoApiKey').value = config.kakaoApiKey;

  // 보안: 모달 열릴 때 모든 API 키 필드를 password로 리셋
  document.querySelectorAll('.btn-toggle-visibility').forEach(btn => {
    const targetId = btn.dataset.target;
    const input = document.getElementById(targetId);
    input.type = 'password';
    btn.classList.remove('active');
    btn.textContent = '👁️';
  });
}

function showApiGuideModal() {
  document.getElementById('apiGuideModal').classList.remove('hidden');
}

function closeAllModals() {
  document.querySelectorAll('.modal').forEach(modal => {
    modal.classList.add('hidden');
  });
}

function saveSettings() {
  config.googleApiKey = document.getElementById('googleApiKey').value.trim();
  config.naverClientId = document.getElementById('naverClientId').value.trim();
  config.naverClientSecret = document.getElementById('naverClientSecret').value.trim();
  config.kakaoApiKey = document.getElementById('kakaoApiKey').value.trim();

  localStorage.setItem('googleApiKey', config.googleApiKey);
  localStorage.setItem('naverClientId', config.naverClientId);
  localStorage.setItem('naverClientSecret', config.naverClientSecret);
  localStorage.setItem('kakaoApiKey', config.kakaoApiKey);

  closeAllModals();

  // Google Maps 다시 로드
  if (config.googleApiKey && !state.map) {
    loadGoogleMaps();
  }

  alert('설정이 저장되었습니다.');
}
