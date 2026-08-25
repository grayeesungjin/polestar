// Car Stats Viewer dashboard backend
// Reads driving data from Google Sheets (populated by Apps Script webhook)
// and provides /api/trips and /api/daily endpoints for the dashboard

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

// Fetch all data from Google Sheets
async function getSheetData() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A:E',
    });
    return response.data.values || [];
  } catch (err) {
    console.error('Error fetching sheet data:', err.message);
    return [];
  }
}

// Parse rows into structured data, skipping header
function parseRows(rows) {
  if (rows.length <= 1) return [];
  
  const data = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 5) continue;
    
    data.push({
      timestamp: row[0],
      distance_m: parseFloat(row[1]) || 0,
      energy_wh: parseFloat(row[2]) || 0,
      soc: parseFloat(row[3]) || null,
      trip_type: parseInt(row[4]) || null,
    });
  }
  return data;
}

// Group points into trips by marker type
function groupIntoTrips(points) {
  const trips = [];
  let currentTrip = null;

  for (const p of points) {
    if (p.trip_type === 1) {
      // Start of new trip
      if (currentTrip) {
        currentTrip.end_timestamp = currentTrip.points[currentTrip.points.length - 1].timestamp;
        trips.push(currentTrip);
      }
      currentTrip = {
        start_timestamp: p.timestamp,
        end_timestamp: null,
        distance_m: 0,
        energy_wh: 0,
        points: [p],
      };
    } else if (p.trip_type === 2) {
      // End of trip
      if (currentTrip) {
        currentTrip.distance_m += p.distance_m;
        currentTrip.energy_wh += p.energy_wh;
        currentTrip.points.push(p);
        currentTrip.end_timestamp = p.timestamp;
        currentTrip.end_soc = p.soc;
        trips.push(currentTrip);
        currentTrip = null;
      }
    } else {
      // Regular point (within trip)
      if (currentTrip) {
        currentTrip.distance_m += p.distance_m;
        currentTrip.energy_wh += p.energy_wh;
        currentTrip.points.push(p);
      }
    }
  }

  // Close any unclosed trip
  if (currentTrip) {
    currentTrip.end_timestamp = currentTrip.points[currentTrip.points.length - 1].timestamp;
    trips.push(currentTrip);
  }

  return trips;
}

// API: GET /api/trips
app.get('/api/trips', async (req, res) => {
  try {
    const rows = await getSheetData();
    const points = parseRows(rows);
    const trips = groupIntoTrips(points);

    // Get last N trips (limit default 30)
    const limit = Math.min(parseInt(req.query.limit || '30', 10), 200);
    const recentTrips = trips.slice(-limit).reverse();

    const result = recentTrips.map(t => {
      const distanceKm = t.distance_m / 1000;
      const startMs = new Date(t.start_timestamp).getTime();
      const endMs = new Date(t.end_timestamp).getTime();
      const durationMin = (endMs - startMs) / 60000;
      const avgConsumptionWhKm = distanceKm > 0.05 ? t.energy_wh / distanceKm : null;
      const avgSpeedKmh = durationMin > 0 ? distanceKm / (durationMin / 60) : null;
      const startSoc = t.points[0]?.soc;
      const endSoc = t.end_soc;

      return {
        start: startMs,
        end: endMs,
        distanceKm: round1(distanceKm),
        energyWh: round1(t.energy_wh),
        durationMin: round1(durationMin),
        avgConsumptionWhKm: avgConsumptionWhKm != null ? round1(avgConsumptionWhKm) : null,
        avgSpeedKmh: avgSpeedKmh != null ? round1(avgSpeedKmh) : null,
        startSoc,
        endSoc,
      };
    });

    res.json({ trips: result });
  } catch (err) {
    console.error('api/trips error:', err);
    res.status(500).json({ error: 'internal error' });
  }
});

// API: GET /api/daily
app.get('/api/daily', async (req, res) => {
  try {
    const rows = await getSheetData();
    const points = parseRows(rows);
    const trips = groupIntoTrips(points);

    const days = Math.min(parseInt(req.query.days || '30', 10), 180);
    const sinceMs = Date.now() - days * 86400000;

    // Group trips by date
    const dailyMap = {};
    for (const trip of trips) {
      const startDate = new Date(trip.start_timestamp);
      const dateKey = startDate.toISOString().split('T')[0]; // YYYY-MM-DD

      if (!dailyMap[dateKey]) {
        dailyMap[dateKey] = { distance_m: 0, energy_wh: 0 };
      }
      dailyMap[dateKey].distance_m += trip.distance_m;
      dailyMap[dateKey].energy_wh += trip.energy_wh;
    }

    // Convert to array and sort by date
    const daily = Object.entries(dailyMap)
      .map(([day, data]) => {
        const distanceKm = data.distance_m / 1000;
        return {
          day,
          distanceKm: round1(distanceKm),
          energyWh: round1(data.energy_wh),
          avgConsumptionWhKm: distanceKm > 0.05 ? round1(data.energy_wh / distanceKm) : null,
        };
      })
      .sort((a, b) => a.day.localeCompare(b.day));

    res.json({ daily });
  } catch (err) {
    console.error('api/daily error:', err);
    res.status(500).json({ error: 'internal error' });
  }
});

function round1(n) {
  return Math.round(n * 10) / 10;
}

app.listen(PORT, () => {
  console.log(`csv-dashboard listening on :${PORT}`);
  console.log(`Sheet ID: ${SHEET_ID}`);
  console.log('Data source: Google Sheets (via Apps Script webhook)');
});
