import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

export interface CalendarEvent {
  title: string;
  startDate: Date;
  endDate?: Date;
  isAllDay: boolean;
  location?: string;
}

export async function fetchCalendarEvents(): Promise<CalendarEvent[]> {
  const keyValue   = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  if (!keyValue || !calendarId) return [];

  const keyJson = keyValue.trim().startsWith('{')
    ? keyValue
    : fs.readFileSync(path.resolve(keyValue), 'utf-8');
  const key = JSON.parse(keyJson) as { client_email: string; private_key: string };

  const auth = new google.auth.JWT({
    email:  key.client_email,
    key:    key.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });

  const cal = google.calendar({ version: 'v3', auth });

  const timeMin = new Date();
  const timeMax = new Date(timeMin);
  timeMax.setDate(timeMax.getDate() + 7);

  const { data } = await cal.events.list({
    calendarId,
    timeMin:      timeMin.toISOString(),
    timeMax:      timeMax.toISOString(),
    singleEvents: true,
    orderBy:      'startTime',
    maxResults:   25,
  });

  return (data.items ?? []).map(event => {
    const isAllDay  = !!event.start?.date;
    const startDate = new Date(
      isAllDay ? `${event.start!.date}T00:00:00` : event.start!.dateTime!
    );
    const endRaw = isAllDay ? event.end?.date : event.end?.dateTime;
    const endDate = endRaw ? new Date(isAllDay ? `${endRaw}T00:00:00` : endRaw) : undefined;

    return {
      title:     event.summary ?? '(No title)',
      startDate,
      endDate,
      isAllDay,
      location:  event.location ?? undefined,
    };
  });
}
