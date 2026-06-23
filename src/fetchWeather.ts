// Dallas, PA 18612
const LAT = 41.3367;
const LON = -75.9638;

export interface DayForecast {
  date: Date;
  dayLabel: string;   // e.g. "Mon", "Tue"
  dateLabel: string;  // e.g. "Jun 23"
  high: number;
  low: number;
  emoji: string;
  description: string;
}

export interface WeatherForecast {
  days: DayForecast[];
  fetchedAt: Date;
}

const WMO_MAP: Array<[number[], string, string]> = [
  [[0],              '☀️',  'Sunny'],
  [[1],              '🌤️',  'Mostly Sunny'],
  [[2],              '⛅',  'Partly Cloudy'],
  [[3],              '☁️',  'Overcast'],
  [[45, 48],         '🌫️',  'Foggy'],
  [[51, 53, 55],     '🌦️',  'Drizzle'],
  [[61, 63, 65],     '🌧️',  'Rain'],
  [[71, 73, 75, 77], '🌨️',  'Snow'],
  [[80, 81, 82],     '🌦️',  'Showers'],
  [[85, 86],         '❄️',  'Snow Showers'],
  [[95, 96, 99],     '⛈️',  'Thunderstorms'],
];

function decodeWmo(code: number): { emoji: string; description: string } {
  for (const [codes, emoji, description] of WMO_MAP) {
    if (codes.includes(code)) return { emoji, description };
  }
  return { emoji: '🌡️', description: 'Unknown' };
}

interface OpenMeteoResponse {
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weathercode: number[];
  };
}

export async function fetchWeather(): Promise<WeatherForecast> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${LAT}&longitude=${LON}` +
    `&daily=temperature_2m_max,temperature_2m_min,weathercode` +
    `&temperature_unit=fahrenheit` +
    `&timezone=America%2FNew_York` +
    `&forecast_days=7`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather API error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as OpenMeteoResponse;
  const { time, temperature_2m_max, temperature_2m_min, weathercode } = data.daily;

  const days: DayForecast[] = time.map((dateStr, i) => {
    const date = new Date(`${dateStr}T12:00:00`);
    const { emoji, description } = decodeWmo(weathercode[i] ?? 0);
    return {
      date,
      dayLabel:  date.toLocaleDateString('en-US', { weekday: 'short' }),
      dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      high: Math.round(temperature_2m_max[i] ?? 0),
      low:  Math.round(temperature_2m_min[i] ?? 0),
      emoji,
      description,
    };
  });

  return { days, fetchedAt: new Date() };
}
