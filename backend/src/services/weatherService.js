import axios from "axios";
import CircuitBreaker from "opossum";
import { weatherDuration } from "../platform/metrics.js";

export class WeatherService {
  constructor({ redis, config, logger }) {
    this.redis = redis;
    this.config = config;
    this.logger = logger;
    this.breaker = new CircuitBreaker(this.lookupRemote.bind(this), {
      timeout: 5000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
    });
  }

  key(lat, lon) {
    return `weather:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  }

  async getWeather(lat, lon) {
    const cacheKey = this.key(lat, lon);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const weather = await this.breaker.fire(lat, lon);
    await this.redis.setEx(
      cacheKey,
      this.config.weather.ttlSeconds,
      JSON.stringify(weather),
    );
    return weather;
  }

  async lookupRemote(lat, lon) {
    if (!this.config.weather.apiKey) {
      if (this.config.platform.productionMode && !this.config.platform.allowSimulatorData) {
        return {
          ambient_temp: null,
          weather_condition: "unavailable",
          airport_code: inferAirportCode(lat, lon),
          source: "unconfigured",
        };
      }

      return {
        ambient_temp: 18,
        weather_condition: "unknown",
        airport_code: "UNK",
        source: "fallback",
      };
    }

    const timer = weatherDuration.startTimer();
    try {
      const response = await axios.get(this.config.weather.baseUrl, {
        params: {
          lat,
          lon,
          appid: this.config.weather.apiKey,
          units: "metric",
        },
      });

      return {
        ambient_temp: response.data.main.temp,
        weather_condition: response.data.weather?.[0]?.main || "Unknown",
        airport_code: inferAirportCode(lat, lon),
        source: "openweathermap",
      };
    } finally {
      timer();
    }
  }

  async getMetar(airport) {
    const code = String(airport || "").trim().toUpperCase();
    if (!code) {
      return null;
    }

    if (!this.config.weather.metarBaseUrl) {
      return null;
    }

    try {
      const response = await axios.get(this.config.weather.metarBaseUrl, {
        params: {
          ids: code,
          format: "json",
        },
        timeout: 8000,
      });
      const row = Array.isArray(response.data) ? response.data[0] : response.data?.data?.[0] || response.data;
      if (!row) {
        return null;
      }
      return {
        airport: code,
        raw: row.rawOb || row.raw_text || null,
        temperatureC: row.temp || row.temp_c || null,
        dewpointC: row.dewp || row.dewpoint_c || null,
        windSpeedKt: row.wspd || row.wind_speed_kt || null,
        visibilityM: row.visib || row.visibility_m || null,
        observedAt: row.obsTime || row.observed || null,
        source: "metar-provider",
      };
    } catch (error) {
      this.logger.warn({ error: error.message, airport: code }, "METAR lookup failed");
      return null;
    }
  }
}

function inferAirportCode(lat, lon) {
  if (lat > 40 && lat < 41 && lon < -73 && lon > -74) return "JFK";
  if (lat > 52 && lat < 53 && lon > 4 && lon < 5.5) return "AMS";
  if (lat > 25 && lat < 26 && lon > 55 && lon < 56) return "DXB";
  return "UNK";
}
