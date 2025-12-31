const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const XLSX = require('xlsx');
const xml2js = require('xml2js');
const JSZip = require('jszip');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// 화장실 데이터 저장 경로
const TOILET_DATA_DIR = path.join(__dirname, 'user_data');
const TOILET_DATA_FILE = path.join(TOILET_DATA_DIR, 'toilets.json');

// user_data 디렉토리 생성
if (!fs.existsSync(TOILET_DATA_DIR)) {
  fs.mkdirSync(TOILET_DATA_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// File upload configuration
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// ============================================
// KML/KMZ 파일 파싱
// ============================================
app.post('/api/parse-kml', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
    }

    let kmlContent;
    const filename = req.file.originalname.toLowerCase();

    if (filename.endsWith('.kmz')) {
      // KMZ 파일 처리 (ZIP 압축)
      const zip = await JSZip.loadAsync(req.file.buffer);
      const kmlFile = Object.keys(zip.files).find(name => name.endsWith('.kml'));
      if (!kmlFile) {
        return res.status(400).json({ error: 'KMZ 파일 내에 KML 파일이 없습니다.' });
      }
      kmlContent = await zip.files[kmlFile].async('string');
    } else {
      kmlContent = req.file.buffer.toString('utf-8');
    }

    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(kmlContent);
    const places = extractPlacesFromKML(result);

    res.json({ success: true, places });
  } catch (error) {
    console.error('KML 파싱 에러:', error);
    res.status(500).json({ error: 'KML 파일 파싱 중 오류가 발생했습니다.' });
  }
});

// KML URL에서 데이터 가져오기
app.post('/api/parse-kml-url', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL이 필요합니다.' });
    }

    // Google My Maps 공유 URL을 KML 다운로드 URL로 변환
    let kmlUrl = url;
    if (url.includes('google.com/maps/d/')) {
      const midMatch = url.match(/mid=([^&]+)/);
      if (midMatch) {
        kmlUrl = `https://www.google.com/maps/d/kml?mid=${midMatch[1]}&forcekml=1`;
      }
    }

    const response = await fetch(kmlUrl);
    if (!response.ok) {
      throw new Error('KML 파일을 가져올 수 없습니다.');
    }

    const kmlContent = await response.text();
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(kmlContent);
    const places = extractPlacesFromKML(result);

    res.json({ success: true, places });
  } catch (error) {
    console.error('KML URL 파싱 에러:', error);
    res.status(500).json({ error: 'URL에서 KML 데이터를 가져오는 중 오류가 발생했습니다. 공유 설정을 확인해주세요.' });
  }
});

function extractPlacesFromKML(kml) {
  const places = [];

  function traverse(obj) {
    if (!obj) return;

    if (obj.Placemark) {
      const placemarks = Array.isArray(obj.Placemark) ? obj.Placemark : [obj.Placemark];
      placemarks.forEach(pm => {
        const place = {
          name: pm.name ? pm.name[0] : '이름 없음',
          description: pm.description ? pm.description[0] : '',
          coordinates: null,
          address: null,
          needsGeocode: false
        };

        // Point 좌표
        if (pm.Point && pm.Point[0] && pm.Point[0].coordinates) {
          const coords = pm.Point[0].coordinates[0].trim().split(',');
          place.coordinates = {
            lng: parseFloat(coords[0]),
            lat: parseFloat(coords[1])
          };
        }

        // 좌표가 없으면 description에서 주소 추출
        if (!place.coordinates && place.description) {
          const addressMatch = place.description.match(/(?:주소|address|위치)?\s*[:\s]*([가-힣]+(?:도|시|군|구)[가-힣0-9\s\-]+)/i);
          if (addressMatch) {
            place.address = addressMatch[1].trim();
            place.needsGeocode = true;
          } else {
            // description 자체가 주소일 수 있음
            const koreanAddressPattern = /^[가-힣]+(?:도|시|군|구|읍|면|동|리|로|길)[가-힣0-9\s\-]+/;
            if (koreanAddressPattern.test(place.description.trim())) {
              place.address = place.description.trim().split('\n')[0];
              place.needsGeocode = true;
            }
          }
        }

        // 좌표가 있거나 주소가 있으면 추가
        if (place.coordinates || place.address) {
          places.push(place);
        }
      });
    }

    // 하위 폴더 탐색
    if (obj.Folder) {
      const folders = Array.isArray(obj.Folder) ? obj.Folder : [obj.Folder];
      folders.forEach(traverse);
    }
    if (obj.Document) {
      const docs = Array.isArray(obj.Document) ? obj.Document : [obj.Document];
      docs.forEach(traverse);
    }
  }

  if (kml.kml) {
    traverse(kml.kml);
  }

  return places;
}

// ============================================
// Google Takeout JSON 파싱
// ============================================
app.post('/api/parse-takeout', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
    }

    const content = req.file.buffer.toString('utf-8');
    let data;

    try {
      data = JSON.parse(content);
    } catch (e) {
      return res.status(400).json({ error: 'JSON 파일 형식이 올바르지 않습니다.' });
    }

    const places = [];

    // GeoJSON FeatureCollection 형식 (Google Takeout 표준)
    if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
      for (const feature of data.features) {
        if (feature.type === 'Feature' && feature.geometry) {
          const props = feature.properties || {};
          const geom = feature.geometry;

          let coordinates = null;
          if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
            coordinates = {
              lng: geom.coordinates[0],
              lat: geom.coordinates[1]
            };
          }

          // 이름 추출 (여러 필드에서 시도)
          const name = props.Title || props.name || props.Name ||
                       props.title || props['Google Maps URL']?.split('/').pop() ||
                       `장소 ${places.length + 1}`;

          // 주소 추출
          const address = props.Location?.Address || props.address ||
                          props.Address || props.location || '';

          places.push({
            name: name,
            description: address || props.Comment || props.description || '',
            coordinates: coordinates,
            address: address,
            needsGeocode: !coordinates
          });
        }
      }
    }
    // 배열 형식 (일부 Takeout 버전)
    else if (Array.isArray(data)) {
      for (const item of data) {
        const name = item.title || item.name || item.Title || `장소 ${places.length + 1}`;
        let coordinates = null;

        if (item.geometry?.location) {
          coordinates = {
            lat: item.geometry.location.lat,
            lng: item.geometry.location.lng
          };
        } else if (item.location) {
          coordinates = {
            lat: item.location.latitude || item.location.lat,
            lng: item.location.longitude || item.location.lng
          };
        } else if (item.lat && item.lng) {
          coordinates = { lat: item.lat, lng: item.lng };
        }

        places.push({
          name: name,
          description: item.address || item.description || '',
          coordinates: coordinates,
          address: item.address || '',
          needsGeocode: !coordinates
        });
      }
    }
    // 단일 객체에 places 배열이 있는 경우
    else if (data.places && Array.isArray(data.places)) {
      for (const item of data.places) {
        const name = item.title || item.name || `장소 ${places.length + 1}`;
        let coordinates = null;

        if (item.location) {
          coordinates = {
            lat: item.location.latitude || item.location.lat,
            lng: item.location.longitude || item.location.lng
          };
        }

        places.push({
          name: name,
          description: item.address || item.description || '',
          coordinates: coordinates,
          address: item.address || '',
          needsGeocode: !coordinates
        });
      }
    }

    if (places.length === 0) {
      return res.status(400).json({
        error: '장소 데이터를 찾을 수 없습니다. Google Takeout에서 내보낸 "저장한 장소" JSON 파일인지 확인해주세요.'
      });
    }

    res.json({
      success: true,
      places: places,
      count: places.length,
      withCoordinates: places.filter(p => p.coordinates).length,
      needsGeocode: places.filter(p => p.needsGeocode).length
    });

  } catch (error) {
    console.error('Takeout 파싱 에러:', error);
    res.status(500).json({ error: '파일 처리 중 오류가 발생했습니다.' });
  }
});

// ============================================
// Geocoding API (주소 → 좌표 변환)
// ============================================
app.post('/api/geocode', async (req, res) => {
  try {
    const { address, kakaoApiKey } = req.body;

    if (!address || !kakaoApiKey) {
      return res.status(400).json({ error: 'address와 kakaoApiKey가 필요합니다.' });
    }

    const encodedAddress = encodeURIComponent(address);
    const apiUrl = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodedAddress}`;

    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `KakaoAK ${kakaoApiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`Kakao API 오류: ${response.status}`);
    }

    const data = await response.json();

    if (data.documents && data.documents.length > 0) {
      const doc = data.documents[0];
      res.json({
        success: true,
        coordinates: {
          lat: parseFloat(doc.y),
          lng: parseFloat(doc.x)
        },
        address: doc.address_name || address
      });
    } else {
      // 주소 검색 실패 시 키워드 검색 시도
      const keywordUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodedAddress}`;
      const keywordResponse = await fetch(keywordUrl, {
        headers: {
          'Authorization': `KakaoAK ${kakaoApiKey}`
        }
      });

      const keywordData = await keywordResponse.json();

      if (keywordData.documents && keywordData.documents.length > 0) {
        const doc = keywordData.documents[0];
        res.json({
          success: true,
          coordinates: {
            lat: parseFloat(doc.y),
            lng: parseFloat(doc.x)
          },
          address: doc.address_name || doc.road_address_name || address
        });
      } else {
        res.json({ success: false, error: '주소를 찾을 수 없습니다.' });
      }
    }
  } catch (error) {
    console.error('Geocoding 에러:', error);
    res.status(500).json({ error: error.message });
  }
});

// 배치 Geocoding (여러 주소 한번에 변환)
app.post('/api/geocode-batch', async (req, res) => {
  try {
    const { places, kakaoApiKey } = req.body;

    if (!places || !kakaoApiKey) {
      return res.status(400).json({ error: 'places와 kakaoApiKey가 필요합니다.' });
    }

    const results = [];
    let successCount = 0;
    let failCount = 0;

    // 순차적으로 처리 (API 호출 제한 고려)
    for (const place of places) {
      if (place.coordinates) {
        results.push(place);
        successCount++;
        continue;
      }

      if (!place.address && !place.name) {
        results.push(place);
        failCount++;
        continue;
      }

      // 장소명으로 먼저 검색 (키워드 검색이 더 정확함)
      const nameQuery = place.name;
      const addressQuery = place.address;

      try {
        let data = { documents: [] };

        // 1. 먼저 장소명으로 키워드 검색
        if (nameQuery) {
          const encodedName = encodeURIComponent(nameQuery);
          const keywordUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodedName}`;
          const response = await fetch(keywordUrl, {
            headers: { 'Authorization': `KakaoAK ${kakaoApiKey}` }
          });
          data = await response.json();
        }

        // 2. 장소명으로 못 찾으면 주소로 검색
        if ((!data.documents || data.documents.length === 0) && addressQuery) {
          const encodedAddress = encodeURIComponent(addressQuery);
          // 주소 검색
          let apiUrl = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodedAddress}`;
          let response = await fetch(apiUrl, {
            headers: { 'Authorization': `KakaoAK ${kakaoApiKey}` }
          });
          data = await response.json();

          // 주소 검색도 실패하면 키워드 검색
          if (!data.documents || data.documents.length === 0) {
            apiUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodedAddress}`;
            response = await fetch(apiUrl, {
              headers: { 'Authorization': `KakaoAK ${kakaoApiKey}` }
            });
            data = await response.json();
          }
        }

        if (data.documents && data.documents.length > 0) {
          const doc = data.documents[0];
          place.coordinates = {
            lat: parseFloat(doc.y),
            lng: parseFloat(doc.x)
          };
          place.needsGeocode = false;
          successCount++;
        } else {
          failCount++;
        }

        results.push(place);

        // API 호출 간격 (초당 10회 제한 고려)
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        console.error(`Geocoding 실패 (${searchQuery}):`, err.message);
        results.push(place);
        failCount++;
      }
    }

    res.json({
      success: true,
      places: results.filter(p => p.coordinates),
      totalProcessed: places.length,
      successCount,
      failCount
    });
  } catch (error) {
    console.error('배치 Geocoding 에러:', error);
    res.status(500).json({ error: error.message });
  }
})

// ============================================
// 공중화장실 데이터 (영구 저장)
// ============================================

// 저장된 화장실 데이터 로드
app.get('/api/toilets', (req, res) => {
  try {
    if (fs.existsSync(TOILET_DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOILET_DATA_FILE, 'utf-8'));
      res.json({
        success: true,
        toilets: data.toilets || [],
        count: data.toilets?.length || 0,
        lastUpdate: data.lastUpdate || null,
        regions: data.regions || []
      });
    } else {
      res.json({
        success: true,
        toilets: [],
        count: 0,
        lastUpdate: null,
        regions: []
      });
    }
  } catch (error) {
    console.error('화장실 데이터 로드 에러:', error);
    res.status(500).json({ error: '데이터 로드 중 오류가 발생했습니다.' });
  }
});

// 화장실 데이터 업로드 (누적 병합)
app.post('/api/parse-toilet', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet);

    // 지역 매핑 테이블
    const regionMap = {
      '서울': '서울시', '서울특별시': '서울시', '서울시': '서울시',
      '부산': '부산시', '부산광역시': '부산시', '부산시': '부산시',
      '대구': '대구시', '대구광역시': '대구시', '대구시': '대구시',
      '인천': '인천시', '인천광역시': '인천시', '인천시': '인천시',
      '광주': '광주시', '광주광역시': '광주시', '광주시': '광주시',
      '대전': '대전시', '대전광역시': '대전시', '대전시': '대전시',
      '울산': '울산시', '울산광역시': '울산시', '울산시': '울산시',
      '세종': '세종시', '세종특별자치시': '세종시', '세종시': '세종시',
      '경기': '경기도', '경기도': '경기도',
      '강원': '강원도', '강원도': '강원도', '강원특별자치도': '강원도',
      '충북': '충청북도', '충청북도': '충청북도',
      '충남': '충청남도', '충청남도': '충청남도',
      '전북': '전라북도', '전라북도': '전라북도', '전북특별자치도': '전라북도',
      '전남': '전라남도', '전라남도': '전라남도',
      '경북': '경상북도', '경상북도': '경상북도',
      '경남': '경상남도', '경상남도': '경상남도',
      '제주': '제주도', '제주도': '제주도', '제주특별자치도': '제주도'
    };

    // 데이터의 주소에서 지역 추출 (첫 10개 샘플링)
    function extractRegionFromData(rows) {
      const regionCounts = {};
      const sampleSize = Math.min(rows.length, 20);

      for (let i = 0; i < sampleSize; i++) {
        const row = rows[i];
        const address = row['소재지도로명주소'] || row['소재지지번주소'] ||
                       row['도로명주소'] || row['주소'] || '';

        if (!address) continue;

        // 주소에서 지역명 추출
        for (const [key, value] of Object.entries(regionMap)) {
          if (address.includes(key)) {
            regionCounts[value] = (regionCounts[value] || 0) + 1;
            break;
          }
        }
      }

      // 가장 많이 나온 지역 반환
      let maxRegion = '기타';
      let maxCount = 0;
      for (const [region, count] of Object.entries(regionCounts)) {
        if (count > maxCount) {
          maxCount = count;
          maxRegion = region;
        }
      }

      return maxRegion;
    }

    // 데이터에서 지역 추출
    const region = extractRegionFromData(data);
    console.log('데이터에서 추출된 지역:', region);

    // 공중화장실 표준 데이터 필드 매핑
    const newToilets = data.map((row, index) => {
      const lat = parseFloat(row['위도'] || row['WGS84위도'] || row['latitude'] || 0);
      const lng = parseFloat(row['경도'] || row['WGS84경도'] || row['longitude'] || 0);

      if (!lat || !lng) return null;

      return {
        id: `${region}_${Date.now()}_${index}`,
        name: row['화장실명'] || row['시설명'] || row['name'] || '공중화장실',
        address: row['소재지도로명주소'] || row['소재지지번주소'] || row['도로명주소'] || row['주소'] || '',
        type: row['구분'] || row['화장실구분'] || row['유형'] || '',
        maleToilet: row['남성용-대변기수'] || row['남성용대변기수'] || 0,
        maleUrinal: row['남성용-소변기수'] || row['남성용소변기수'] || 0,
        femaleToilet: row['여성용-대변기수'] || row['여성용대변기수'] || 0,
        disabledToilet: row['장애인용-남성대변기수'] || row['장애인용남성대변기수'] || 0,
        openTime: row['개방시간'] || row['운영시간'] || '24시간',
        manager: row['관리기관명'] || row['관리기관'] || '',
        phone: row['전화번호'] || row['연락처'] || '',
        region: region,
        lat,
        lng
      };
    }).filter(t => t !== null);

    // 기존 데이터 로드
    let existingData = { toilets: [], regions: [], lastUpdate: null };
    if (fs.existsSync(TOILET_DATA_FILE)) {
      existingData = JSON.parse(fs.readFileSync(TOILET_DATA_FILE, 'utf-8'));
    }

    // 동일 지역 데이터는 교체, 새 지역 데이터는 추가
    const existingToilets = existingData.toilets.filter(t => t.region !== region);
    const mergedToilets = [...existingToilets, ...newToilets];

    // 지역 목록 업데이트
    const regions = [...new Set(mergedToilets.map(t => t.region))].sort();

    // 저장
    const saveData = {
      toilets: mergedToilets,
      regions: regions,
      lastUpdate: new Date().toISOString()
    };
    fs.writeFileSync(TOILET_DATA_FILE, JSON.stringify(saveData, null, 2));

    res.json({
      success: true,
      toilets: mergedToilets,
      count: mergedToilets.length,
      newCount: newToilets.length,
      region: region,
      regions: regions,
      lastUpdate: saveData.lastUpdate
    });
  } catch (error) {
    console.error('화장실 데이터 파싱 에러:', error);
    res.status(500).json({ error: '파일 파싱 중 오류가 발생했습니다.' });
  }
});

// 화장실 데이터 초기화
app.delete('/api/toilets', (req, res) => {
  try {
    if (fs.existsSync(TOILET_DATA_FILE)) {
      fs.unlinkSync(TOILET_DATA_FILE);
    }
    res.json({ success: true, message: '화장실 데이터가 초기화되었습니다.' });
  } catch (error) {
    console.error('화장실 데이터 삭제 에러:', error);
    res.status(500).json({ error: '데이터 삭제 중 오류가 발생했습니다.' });
  }
});

// ============================================
// 네이버 검색 API
// ============================================
app.post('/api/naver-search', async (req, res) => {
  try {
    const { query, clientId, clientSecret, type = 'blog' } = req.body;

    if (!query || !clientId || !clientSecret) {
      return res.status(400).json({ error: 'query, clientId, clientSecret가 필요합니다.' });
    }

    const searchQuery = encodeURIComponent(query);
    const apiUrl = `https://openapi.naver.com/v1/search/${type}.json?query=${searchQuery}&display=20&sort=sim`;

    const response = await fetch(apiUrl, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`네이버 API 오류: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // 검색 결과 요약 분석
    const analysis = analyzeSearchResults(data.items, query);

    res.json({
      success: true,
      items: data.items,
      total: data.total,
      analysis
    });
  } catch (error) {
    console.error('네이버 검색 에러:', error);
    res.status(500).json({ error: error.message });
  }
});

// 검색 결과 요약 분석 함수
function analyzeSearchResults(items, query) {
  if (!items || items.length === 0) {
    return {
      summary: '검색 결과가 없습니다.',
      keywords: [],
      sentiment: 'neutral',
      highlights: []
    };
  }

  // HTML 태그 제거 함수
  const stripHtml = (str) => str.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ');

  // 모든 텍스트 합치기
  const allText = items.map(item =>
    stripHtml(item.title + ' ' + (item.description || ''))
  ).join(' ');

  // 차박 관련 키워드 추출
  const carbakKeywords = {
    positive: ['좋아요', '추천', '최고', '깨끗', '넓어요', '편해요', '조용', '쾌적', '안전', '좋았', '만족', '굿', '대박'],
    negative: ['별로', '비추', '더러워', '좁아요', '불편', '시끄러워', '위험', '실망', '최악', '안좋'],
    facilities: ['화장실', '편의점', '마트', '주차', '전기', '수도', '샤워', '취사', '바베큐', '테이블', '벤치'],
    environment: ['뷰', '전망', '야경', '일출', '일몰', '바다', '산', '강', '호수', '숲']
  };

  // 키워드 빈도 분석
  const foundKeywords = {};
  Object.entries(carbakKeywords).forEach(([category, words]) => {
    words.forEach(word => {
      const regex = new RegExp(word, 'gi');
      const matches = allText.match(regex);
      if (matches) {
        foundKeywords[word] = {
          count: matches.length,
          category
        };
      }
    });
  });

  // 감성 분석 (긍정/부정 비율)
  let positiveCount = 0;
  let negativeCount = 0;
  Object.entries(foundKeywords).forEach(([word, info]) => {
    if (info.category === 'positive') positiveCount += info.count;
    if (info.category === 'negative') negativeCount += info.count;
  });

  let sentiment = 'neutral';
  let sentimentScore = 0;
  if (positiveCount + negativeCount > 0) {
    sentimentScore = (positiveCount - negativeCount) / (positiveCount + negativeCount);
    if (sentimentScore > 0.2) sentiment = 'positive';
    else if (sentimentScore < -0.2) sentiment = 'negative';
  }

  // 주요 하이라이트 추출 (제목에서)
  const highlights = items.slice(0, 5).map(item => ({
    title: stripHtml(item.title),
    link: item.link,
    date: item.postdate || item.datetime || ''
  }));

  // 시설 관련 키워드 정리
  const facilityMentions = Object.entries(foundKeywords)
    .filter(([_, info]) => info.category === 'facilities')
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([word, info]) => ({ word, count: info.count }));

  // 환경 관련 키워드 정리
  const environmentMentions = Object.entries(foundKeywords)
    .filter(([_, info]) => info.category === 'environment')
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([word, info]) => ({ word, count: info.count }));

  // 요약 생성
  let summary = `"${query}" 관련 ${items.length}개의 글을 분석했습니다. `;
  if (sentiment === 'positive') {
    summary += '전반적으로 긍정적인 후기가 많습니다. ';
  } else if (sentiment === 'negative') {
    summary += '부정적인 의견이 다소 있으니 참고하세요. ';
  }
  if (facilityMentions.length > 0) {
    summary += `자주 언급된 시설: ${facilityMentions.map(f => f.word).join(', ')}. `;
  }
  if (environmentMentions.length > 0) {
    summary += `주변 환경: ${environmentMentions.map(e => e.word).join(', ')}.`;
  }

  return {
    summary,
    sentiment,
    sentimentScore: Math.round(sentimentScore * 100),
    totalResults: items.length,
    keywords: {
      facilities: facilityMentions,
      environment: environmentMentions,
      positive: Object.entries(foundKeywords)
        .filter(([_, info]) => info.category === 'positive')
        .map(([word, info]) => ({ word, count: info.count })),
      negative: Object.entries(foundKeywords)
        .filter(([_, info]) => info.category === 'negative')
        .map(([word, info]) => ({ word, count: info.count }))
    },
    highlights
  };
}

// ============================================
// 정적 파일 서빙
// ============================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
