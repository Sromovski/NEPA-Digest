import type { FamilyMember } from './types';
import type { RankedArticle } from './rankAndSummarize';

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  news:   { bg: '#dbeafe', text: '#1e40af' },
  events: { bg: '#dcfce7', text: '#15803d' },
  sports: { bg: '#fef9c3', text: '#854d0e' },
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
  dateRange: string
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
