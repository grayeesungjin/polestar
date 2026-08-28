// Polestar 대시보드 백엔드
// Sheet1: 주행기록, Sheet2: 충전기록

const path = require('path');
const express = require('express');
const { google } = require('googleapis');

const PORT = process.env.PORT || 3000;
const SHEET_ID = process.env.SHEET_ID || '1Y8sw6afba_utskOzpPRE6-xTCkXRzH2VZcOAibRBCK8';
const API_KEY = process.env.API_KEY || 'AIzaSyD-B2ezyeLiPka1rW6yZLp1Uw1SvdDmzMI';

const sheets = google.sheets({
  version: 'v4',
  auth: API_KEY,
});

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// ========== 데이터 조회 ==========

// Sheet1 (주행기록) 데이터 조회
async function getSheetData(sheetName = 'Sheet1') {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!A:E`,
    });
    return response.data.values || [];
  } catch (err) {
    console.error(`Error fetching ${sheetName}:`, err.message);
    return [];
  }
}

// 행을 구조화된 데이터로 파싱
function parseRows(rows, type = 'drive') {
  if (rows.length <= 1) return [];
  
  const data = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 5) continue;
    
    if (type === 'drive') {
      data.push({
        timestamp: row[0],
        distance_m: parseFloat(row[1]) || 0,
        battery_soc: parseFloat(row[2]) || 0,
        avg_speed: parseFloat(row[3]) || 0,
        trip_type: parseInt(row[4]) || null,
      });
    } else if (type === 'charge') {
      data.push({
        timestamp: row[0],
        start_soc: parseFloat(row[1]) || 0,
        end_soc: parseFloat(row[2]) || 0,
        duration_min: parseInt(row[3]) || 0,
        charge_type: parseInt(row[4]) || null,
      });
    }
  }
  return data;
}

// 주행 데이터를 트립으로 그룹화
function groupIntoTrips(points) {
  const trips = [];
  let currentTrip = null;

  for (const p of points) {
    if (p.trip_type === 1) {
      // 트립 시작
      if (currentTrip) {
        currentTrip.end_timestamp = currentTrip.points[currentTrip.points.length - 1].timestamp;
        trips.push(currentTrip);
      }
      currentTrip = {
        start_timestamp: p.timestamp,
        end_timestamp: null,
        points: [p],
      };
    } else if (p.trip_type === 2) {
      // 트립 종료
      if (currentTrip) {
        currentTrip.points.push(p);
        currentTrip.end_timestamp = p.timestamp;
        currentTrip.end_soc = p.battery_soc;
        trips.push(currentTrip);
        currentTrip = null;
      }
    }
  }

  return trips;
}

// 트립 통계 계산
function calculateTripStats(trip) {
  const startPoint = trip.points[0];
  const endPoint = trip.points[trip.points.length - 1];
  
  const startDistance = startPoint.distance_m;
  const endDistance = endPoint.distance_m;
  const distanceKm = (endDistance - startDistance) / 1000;
  
  const startSoc = startPoint.battery_soc;
  const endSoc = endPoint.battery_soc;
  const socChange = startSoc - endSoc;
  
  const startTime = new Date(trip.start_timestamp).getTime();
  const endTime = new Date(trip.end_timestamp).getTime();
  const durationMin = (endTime - startTime) / 60000;
  const durationHours = durationMin / 60;
  
  // 에너지 계산 (배터리 102kWh)
  const energyConsumedKwh = socChange * 102;
  const energyConsumedWh = energyConsumedKwh * 1000;
  
  // 전비
  const efficiencyKmPerKwh = energyConsumedKwh > 0 ? distanceKm / energyConsumedKwh : 0;
  const consumptionWhKm = distanceKm > 0 ? energyConsumedWh / distanceKm : 0;
  
  // 평균 속도
  const avgSpeedKmh = durationHours > 0 ? distanceKm / durationHours : 0;
  
  return {
    start: startTime,
    end: endTime,
    distanceKm: round1(distanceKm),
    energyKwh: round1(energyConsumedKwh),
    energyWh: round1(energyConsumedWh),
    durationMin: round1(durationMin),
    avgSpeedKmh: round1(avgSpeedKmh),
    efficiencyKmPerKwh: round1(efficiencyKmPerKwh),
    consumptionWhKm: round1(consumptionWhKm),
    startSoc: round1(startSoc * 100),
    endSoc: round1(endSoc * 100),
  };
}

// ========== API: 주행 기록 ==========

app.get('/api/trips/today', async (req, res) => {
  try {
    const rows = await getSheetData('Sheet1');
    const points = parseRows(rows, 'drive');
    const trips = groupIntoTrips(points);
    
    // 오늘 데이터만
    const today = new Date().toISOString().split('T')[0];
    const todayTrips = trips
      .filter(t => t.start_timestamp.startsWith(today))
      .map(calculateTripStats);
    
    res.json({ trips: todayTrips });
  } catch (err) {
    console.error('api/trips/today error:', err);
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/api/trips/month', async (req, res) => {
  try {
    const rows = await getSheetData('Sheet1');
    const points = parseRows(rows, 'drive');
    const trips = groupIntoTrips(points);
    
    // 이번 달 데이터
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthTrips = trips
      .filter(t => t.start_timestamp.startsWith(currentMonth))
      .map(calculateTripStats);
    
    res.json({ trips: monthTrips });
  } catch (err) {
    console.error('api/trips/month error:', err);
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/api/trips/year', async (req, res) => {
  try {
    const rows = await getSheetData('Sheet1');
    const points = parseRows(rows, 'drive');
    const trips = groupIntoTrips(points);
    
    // 올해 데이터
    const currentYear = new Date().getFullYear().toString();
    const yearTrips = trips
      .filter(t => t.start_timestamp.startsWith(currentYear))
      .map(calculateTripStats);
    
    res.json({ trips: yearTrips });
  } catch (err) {
    console.error('api/trips/year error:', err);
    res.status(500).json({ error: 'internal error' });
  }
});

// ========== API: 일별 통계 ==========

app.get('/api/daily', async (req, res) => {
  try {
    const rows = await getSheetData('Sheet1');
    const points = parseRows(rows, 'drive');
    const trips = groupIntoTrips(points);
    
    // 일별 그룹화
    const dailyMap = {};
    for (const trip of trips) {
      const startDate = new Date(trip.start_timestamp).toISOString().split('T')[0];
      
      if (!dailyMap[startDate]) {
        dailyMap[startDate] = {
          distanceKm: 0,
          energyKwh: 0,
          durationMin: 0,
          trips: 0,
          efficiencies: [],
        };
      }
      
      const stats = calculateTripStats(trip);
      dailyMap[startDate].distanceKm += stats.distanceKm;
      dailyMap[startDate].energyKwh += stats.energyKwh;
      dailyMap[startDate].durationMin += stats.durationMin;
      dailyMap[startDate].trips += 1;
      dailyMap[startDate].efficiencies.push(stats.efficiencyKmPerKwh);
    }
    
    // 일별 통계 계산
    const daily = Object.entries(dailyMap)
      .map(([day, data]) => {
        const avgEfficiency = data.efficiencies.length > 0
          ? data.efficiencies.reduce((a, b) => a + b) / data.efficiencies.length
          : 0;
        
        return {
          day,
          distanceKm: round1(data.distanceKm),
          energyKwh: round1(data.energyKwh),
          consumptionWhKm: data.distanceKm > 0 ? round1((data.energyKwh * 1000) / data.distanceKm) : 0,
          durationMin: round1(data.durationMin),
          tripCount: data.trips,
          efficiencyKmPerKwh: round1(avgEfficiency),
        };
      })
      .sort((a, b) => a.day.localeCompare(b.day));
    
    res.json({ daily });
  } catch (err) {
    console.error('api/daily error:', err);
    res.status(500).json({ error: 'internal error' });
  }
});

// ========== API: 월별 통계 ==========

app.get('/api/monthly', async (req, res) => {
  try {
    const rows = await getSheetData('Sheet1');
    const points = parseRows(rows, 'drive');
    const trips = groupIntoTrips(points);
    
    // 월별 그룹화
    const monthlyMap = {};
    for (const trip of trips) {
      const month = trip.start_timestamp.substring(0, 7); // YYYY-MM
      
      if (!monthlyMap[month]) {
        monthlyMap[month] = {
          distanceKm: 0,
          energyKwh: 0,
          durationMin: 0,
          trips: 0,
          efficiencies: [],
        };
      }
      
      const stats = calculateTripStats(trip);
      monthlyMap[month].distanceKm += stats.distanceKm;
      monthlyMap[month].energyKwh += stats.energyKwh;
      monthlyMap[month].durationMin += stats.durationMin;
      monthlyMap[month].trips += 1;
      monthlyMap[month].efficiencies.push(stats.efficiencyKmPerKwh);
    }
    
    const monthly = Object.entries(monthlyMap)
      .map(([month, data]) => {
        const avgEfficiency = data.efficiencies.length > 0
          ? data.efficiencies.reduce((a, b) => a + b) / data.efficiencies.length
          : 0;
        
        return {
          month,
          distanceKm: round1(data.distanceKm),
          energyKwh: round1(data.energyKwh),
          consumptionWhKm: data.distanceKm > 0 ? round1((data.energyKwh * 1000) / data.distanceKm) : 0,
          durationMin: round1(data.durationMin),
          tripCount: data.trips,
          efficiencyKmPerKwh: round1(avgEfficiency),
        };
      })
      .sort((a, b) => a.month.localeCompare(b.month));
    
    res.json({ monthly });
  } catch (err) {
    console.error('api/monthly error:', err);
    res.status(500).json({ error: 'internal error' });
  }
});

// ========== API: 연별 통계 ==========

app.get('/api/yearly', async (req, res) => {
  try {
    const rows = await getSheetData('Sheet1');
    const points = parseRows(rows, 'drive');
    const trips = groupIntoTrips(points);
    
    // 연별 그룹화
    const yearlyMap = {};
    for (const trip of trips) {
      const year = trip.start_timestamp.substring(0, 4);
      
      if (!yearlyMap[year]) {
        yearlyMap[year] = {
          distanceKm: 0,
          energyKwh: 0,
          durationMin: 0,
          trips: 0,
          efficiencies: [],
        };
      }
      
      const stats = calculateTripStats(trip);
      yearlyMap[year].distanceKm += stats.distanceKm;
      yearlyMap[year].energyKwh += stats.energyKwh;
      yearlyMap[year].durationMin += stats.durationMin;
      yearlyMap[year].trips += 1;
      yearlyMap[year].efficiencies.push(stats.efficiencyKmPerKwh);
    }
    
    const yearly = Object.entries(yearlyMap)
      .map(([year, data]) => {
        const avgEfficiency = data.efficiencies.length > 0
          ? data.efficiencies.reduce((a, b) => a + b) / data.efficiencies.length
          : 0;
        
        return {
          year,
          distanceKm: round1(data.distanceKm),
          energyKwh: round1(data.energyKwh),
          consumptionWhKm: data.distanceKm > 0 ? round1((data.energyKwh * 1000) / data.distanceKm) : 0,
          durationMin: round1(data.durationMin),
          tripCount: data.trips,
          efficiencyKmPerKwh: round1(avgEfficiency),
        };
      })
      .sort((a, b) => a.year.localeCompare(b.year));
    
    res.json({ yearly });
  } catch (err) {
    console.error('api/yearly error:', err);
    res.status(500).json({ error: 'internal error' });
  }
});

// ========== API: 충전 기록 ==========

app.get('/api/charging', async (req, res) => {
  try {
    const rows = await getSheetData('Sheet2');
    const chargeData = parseRows(rows, 'charge');
    
    // 충전 시작과 종료를 쌍으로 연결
    const chargingSessions = [];
    let currentCharge = null;
    
    for (const charge of chargeData) {
      if (charge.charge_type === 1) {
        // 충전 시작
        if (currentCharge) {
          chargingSessions.push(currentCharge);
        }
        currentCharge = {
          start_timestamp: charge.timestamp,
          start_soc: charge.start_soc,
          end_timestamp: null,
          end_soc: null,
          duration_min: 0,
        };
      } else if (charge.charge_type === 2) {
        // 충전 종료
        if (currentCharge) {
          currentCharge.end_timestamp = charge.timestamp;
          currentCharge.end_soc = charge.end_soc;
          currentCharge.duration_min = charge.duration_min;
          chargingSessions.push(currentCharge);
          currentCharge = null;
        }
      }
    }
    
    // 충전 세션 통계
    const sessions = chargingSessions.map(session => {
      const startTime = new Date(session.start_timestamp).getTime();
      const endTime = new Date(session.end_timestamp).getTime();
      
      const socCharged = session.end_soc - session.start_soc;
      const energyCharged = socCharged * 102; // kWh
      const avgPowerKw = energyCharged / (session.duration_min / 60);
      
      // 충전 손실 추정 (AC: 13.4%, DC: 22.2%)
      const chargeLossPercent = avgPowerKw > 50 ? 22.2 : 13.4; // DC or AC
      const gridEnergyNeeded = energyCharged / ((100 - chargeLossPercent) / 100);
      const energyLossKwh = gridEnergyNeeded - energyCharged;
      
      return {
        start: startTime,
        end: endTime,
        startSoc: round1(session.start_soc * 100),
        endSoc: round1(session.end_soc * 100),
        socCharged: round1(socCharged * 100),
        energyChargedKwh: round1(energyCharged),
        durationMin: round1(session.duration_min),
        avgPowerKw: round1(avgPowerKw),
        estimatedLossKwh: round1(energyLossKwh),
        chargeType: avgPowerKw > 50 ? 'DC' : 'AC',
      };
    }).reverse(); // 최신순
    
    res.json({ sessions });
  } catch (err) {
    console.error('api/charging error:', err);
    res.status(500).json({ error: 'internal error' });
  }
});

// ========== 유틸 ==========
function round1(n) {
  return Math.round(n * 10) / 10;
}

app.listen(PORT, () => {
  console.log(`🚗 Polestar 대시보드 listening on :${PORT}`);
  console.log(`Sheet ID: ${SHEET_ID}`);
});
