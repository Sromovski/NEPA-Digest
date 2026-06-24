import type { FamilyMember, Article } from './types';
import type { RankedArticle } from './rankAndSummarize';
import type { WeatherForecast } from './fetchWeather';
import type { CalendarEvent } from './fetchCalendar';

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  news:     { bg: '#dbeafe', text: '#1e40af' },
  events:   { bg: '#dcfce7', text: '#15803d' },
  sports:   { bg: '#fef9c3', text: '#854d0e' },
  national: { bg: '#f3e8ff', text: '#7e22ce' },
};

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : '#';
  } catch {
    return '#';
  }
}

function categoryBadge(category: string): string {
  const colors = CATEGORY_COLORS[category] ?? { bg: '#f3f4f6', text: '#374151' };
  return `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;letter-spacing:0.05em;background:${colors.bg};color:${colors.text};text-transform:uppercase;">${escHtml(category)}</span>`;
}

function weatherSection(forecast: WeatherForecast): string {
  const cols = forecast.days.map(d => `
    <td align="center" style="padding:0 4px;width:${Math.floor(100 / forecast.days.length)}%;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td align="center"
              style="font-size:12px;font-weight:700;color:#1e3a5f;padding:0 0 2px 0;
                     letter-spacing:0.04em;">
            ${escHtml(d.dayLabel)}
          </td>
        </tr>
        <tr>
          <td align="center"
              style="font-size:10px;color:#6b7280;padding:0 0 6px 0;">
            ${escHtml(d.dateLabel)}
          </td>
        </tr>
        <tr>
          <td align="center" style="font-size:22px;padding:0 0 6px 0;line-height:1;">
            ${d.emoji}
          </td>
        </tr>
        <tr>
          <td align="center"
              style="font-size:10px;color:#374151;padding:0 0 6px 0;
                     white-space:nowrap;overflow:hidden;">
            ${escHtml(d.description)}
          </td>
        </tr>
        <tr>
          <td align="center"
              style="font-size:13px;font-weight:700;color:#111827;padding:0 0 2px 0;">
            ${d.high}&deg;
          </td>
        </tr>
        <tr>
          <td align="center" style="font-size:12px;color:#6b7280;">
            ${d.low}&deg;
          </td>
        </tr>
      </table>
    </td>`).join('');

  return `
    <tr>
      <td style="padding:0 0 24px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="background:#f0f7ff;border:1px solid #bfdbfe;border-radius:8px;
                      overflow:hidden;">
          <tr>
            <td style="padding:14px 16px 6px 16px;">
              <p style="margin:0 0 10px 0;font-size:12px;font-weight:700;
                         letter-spacing:0.08em;color:#1e40af;text-transform:uppercase;">
                &#127777;&#65039; 7-Day Forecast &mdash; Dallas, PA
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>${cols}</tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 16px 10px 16px;">
              <p style="margin:0;font-size:10px;color:#93c5fd;text-align:right;">
                via Open-Meteo &middot; updated ${forecast.fetchedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function calendarSection(events: CalendarEvent[]): string {
  if (events.length === 0) return '';

  const rows = events.map(ev => {
    const dayName = ev.startDate.toLocaleDateString('en-US', { weekday: 'short' });
    const dateStr = ev.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const timeStr = ev.isAllDay
      ? 'All day'
      : ev.startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;vertical-align:top;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="64" style="vertical-align:top;padding-right:12px;">
                <div style="background:#1e3a5f;border-radius:6px;text-align:center;padding:4px 0;">
                  <div style="font-size:10px;font-weight:700;color:#93c5fd;text-transform:uppercase;
                               letter-spacing:0.08em;line-height:1.4;">${escHtml(dayName)}</div>
                  <div style="font-size:15px;font-weight:700;color:#ffffff;line-height:1.2;">${escHtml(dateStr.split(' ')[1])}</div>
                  <div style="font-size:9px;color:#bfdbfe;line-height:1.4;">${escHtml(dateStr.split(' ')[0])}</div>
                </div>
              </td>
              <td style="vertical-align:top;">
                <div style="font-size:14px;font-weight:600;color:#111827;line-height:1.4;">
                  ${escHtml(ev.title)}
                </div>
                <div style="font-size:12px;color:#6b7280;margin-top:2px;">
                  &#128337; ${escHtml(timeStr)}${ev.location ? ` &nbsp;&middot;&nbsp; &#128205; ${escHtml(ev.location)}` : ''}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join('');

  return `
    <tr>
      <td style="padding:0 0 24px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:14px 16px 4px 16px;">
              <p style="margin:0 0 10px 0;font-size:12px;font-weight:700;
                         letter-spacing:0.08em;color:#92400e;text-transform:uppercase;">
                &#128197; Family Calendar &mdash; Upcoming This Week
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${rows}
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function nationalSection(articles: Article[]): string {
  if (articles.length === 0) return '';

  const rows = articles.map(a => {
    const date = a.pubDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #e9d5ff;">
          <a href="${sanitizeUrl(a.link)}"
             style="font-size:14px;font-weight:600;color:#111827;text-decoration:none;line-height:1.4;display:block;">
            ${escHtml(a.title)}
          </a>
          <div style="font-size:11px;color:#9ca3af;margin-top:3px;">
            ${escHtml(a.source)} &nbsp;&middot;&nbsp; ${escHtml(date)}
          </div>
        </td>
      </tr>`;
  }).join('');

  return `
    <tr>
      <td style="padding:0 0 24px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:14px 16px 4px 16px;">
              <p style="margin:0 0 8px 0;font-size:12px;font-weight:700;
                         letter-spacing:0.08em;color:#7e22ce;text-transform:uppercase;">
                &#127758; National Headlines
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${rows}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 16px 10px 16px;">
              <p style="margin:0;font-size:10px;color:#c4b5fd;text-align:right;">
                via AP News &amp; NPR &mdash; non-partisan wire sources
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function articleRow(item: RankedArticle): string {
  const { article, summary } = item;
  const date = article.pubDate.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  return `
    <tr>
      <td style="padding:0 0 24px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:16px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:0 0 8px 0;">
                    ${categoryBadge(article.category)}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 8px 0;">
                    <a href="${sanitizeUrl(article.link)}"
                       style="font-size:16px;font-weight:600;color:#111827;text-decoration:none;line-height:1.4;">
                      ${escHtml(article.title)}
                    </a>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 10px 0;font-size:14px;color:#374151;line-height:1.6;">
                    ${escHtml(summary)}
                  </td>
                </tr>
                <tr>
                  <td style="font-size:12px;color:#6b7280;">
                    ${escHtml(article.source)} &nbsp;&middot;&nbsp; ${date}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

export function renderDigestEmail(
  member: FamilyMember,
  articles: RankedArticle[],
  nationalArticles: Article[],
  dateRange: string,
  weather?: WeatherForecast,
  calendarEvents?: CalendarEvent[]
): string {
  const rows = articles.map(articleRow).join('');

  const noArticlesMsg = `
    <tr>
      <td style="padding:24px;text-align:center;color:#6b7280;font-size:14px;">
        No new articles matched your interests this week. Check back next week!
      </td>
    </tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Luzerne County Weekly Digest — ${escHtml(member.name)}</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Georgia,serif;">

  <table width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:#f9fafb;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0"
               style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#1e3a5f;border-radius:8px 8px 0 0;padding:28px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <p style="margin:0 0 4px 0;font-size:11px;font-weight:600;
                               letter-spacing:0.1em;color:#93c5fd;text-transform:uppercase;">
                      Luzerne County, Pennsylvania
                    </p>
                    <h1 style="margin:0;font-size:24px;color:#ffffff;font-family:Georgia,serif;">
                      Luzerne County Weekly Digest
                    </h1>
                  </td>
                  <td align="right" style="vertical-align:bottom;">
                    <p style="margin:0;font-size:13px;color:#bfdbfe;">
                      For ${escHtml(member.name)}<br>
                      <span style="font-size:11px;color:#93c5fd;">${escHtml(dateRange)}</span>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Interests bar -->
          <tr>
            <td style="background:#1e40af;padding:10px 32px;">
              <p style="margin:0;font-size:12px;color:#bfdbfe;">
                Curated for your interests:
                <span style="color:#ffffff;">${member.interests.map(escHtml).join(' &nbsp;&middot;&nbsp; ')}</span>
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:28px 32px 8px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${weather ? weatherSection(weather) : ''}
                ${calendarEvents && calendarEvents.length > 0 ? calendarSection(calendarEvents) : ''}
                ${nationalSection(nationalArticles)}
                ${articles.length > 0 ? rows : noArticlesMsg}
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f3f4f6;border-radius:0 0 8px 8px;
                        padding:20px 32px;border-top:1px solid #e5e7eb;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:12px;color:#6b7280;line-height:1.6;">
                    <p style="margin:0 0 6px 0;">
                      Original reporting linked above &mdash; read full articles at the source.
                      Summaries are written in original words; no article text is reproduced.
                    </p>
                    <p style="margin:0;color:#9ca3af;">
                      This digest is a personal family project.
                      To update your interests or unsubscribe, reply to this email.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}
