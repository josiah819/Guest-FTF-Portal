// Branded HTML email templates. Mirrors the frontend design system
// (styles.css): Muskoka Blue teal header, Sign Green CTA, paper background.
// Every email keeps a plain-text twin in the caller — HTML here is additive,
// so clients that strip it still get the full message. Layout is table-based
// with inline styles because that is what Outlook and Gmail actually render.

const C = {
  teal: '#1E5A64',
  tealDark: '#1B4849',
  tealDeep: '#12343A',
  green: '#A3CD42',
  paper: '#F7F4EC',
  ink: '#1C2B2E',
  inkSoft: '#4D6166',
  inkFaint: '#7D8E92',
  line: '#E2DDD2',
  card: '#FFFFFF',
};

const FONT_HEAD = "'Montserrat','Trebuchet MS','Segoe UI',Arial,sans-serif";
const FONT_BODY = "'Nunito Sans','Segoe UI',Arial,sans-serif";

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Shared shell: paper backdrop, 600px white card with a teal masthead.
// `logoUrl` is optional — with no public origin we fall back to a text
// wordmark rather than shipping a broken image.
function shell({ logoUrl, kicker, bodyHtml }) {
  const masthead = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="216" alt="Muskoka Woods"
           style="display:block;width:216px;max-width:60%;height:auto;border:0;margin:0 auto;" />`
    : `<div style="font-family:${FONT_HEAD};font-weight:800;font-size:22px;letter-spacing:0.08em;color:#FFFFFF;">
         MUSKOKA<span style="color:${C.green};">WOODS</span>
       </div>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<style>
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800&family=Nunito+Sans:wght@400;700&display=swap');
</style>
</head>
<body style="margin:0;padding:0;background:${C.paper};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
           style="width:100%;max-width:600px;background:${C.card};border-radius:14px;overflow:hidden;box-shadow:0 6px 24px -8px rgba(28,43,46,0.12);">
      <tr>
        <td align="center" style="background:${C.teal};border-bottom:4px solid ${C.green};padding:30px 24px 26px;">
          ${masthead}
          <div style="font-family:${FONT_HEAD};font-weight:700;font-size:11px;letter-spacing:0.22em;color:${C.green};padding-top:14px;">
            ${escapeHtml(kicker)}
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:36px 40px 32px;">
          ${bodyHtml}
        </td>
      </tr>
    </table>
    <div style="font-family:${FONT_BODY};font-size:12px;color:${C.inkFaint};padding-top:18px;">
      WoodsVoice · Muskoka Woods guest care
    </div>
  </td></tr>
</table>
</body>
</html>`;
}

// Table-based CTA button so Outlook honours the fill; matches .btn-primary.
function ctaButton(url, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:26px auto;">
    <tr>
      <td align="center" bgcolor="${C.green}" style="border-radius:14px;">
        <a href="${escapeHtml(url)}"
           style="display:inline-block;padding:17px 34px;font-family:${FONT_HEAD};font-weight:800;font-size:14px;letter-spacing:0.1em;text-transform:uppercase;color:${C.tealDeep};text-decoration:none;border-radius:14px;">
          ${escapeHtml(label)}
        </a>
      </td>
    </tr>
  </table>`;
}

function inviteEmailHtml({ inviterName, acceptUrl, logoUrl, expiresDays }) {
  const inviter = escapeHtml(inviterName || 'A teammate');
  const bodyHtml = `
    <div style="font-family:${FONT_HEAD};font-weight:700;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:${C.teal};">
      You&rsquo;re invited
    </div>
    <h1 style="margin:10px 0 18px;font-family:${FONT_HEAD};font-weight:800;font-size:26px;line-height:1.2;color:${C.ink};">
      Join the WoodsVoice team
    </h1>
    <p style="margin:0 0 6px;font-family:${FONT_BODY};font-size:16px;line-height:1.55;color:${C.ink};">
      <strong>${inviter}</strong> has invited you to join WoodsVoice,
      Muskoka Woods&rsquo; guest care portal.
    </p>
    ${ctaButton(acceptUrl, 'Set up your account')}
    <p style="margin:0;font-family:${FONT_BODY};font-size:14.5px;line-height:1.55;color:${C.inkSoft};" align="center">
      Finish with your Google account or set a password &mdash;<br />either way takes under a minute.
    </p>
    <hr style="border:0;border-top:1px solid ${C.line};margin:28px 0 20px;" />
    <p style="margin:0 0 10px;font-family:${FONT_BODY};font-size:12.5px;line-height:1.6;color:${C.inkFaint};">
      Button not working? Paste this link into your browser:<br />
      <a href="${escapeHtml(acceptUrl)}" style="color:${C.teal};word-break:break-all;">${escapeHtml(acceptUrl)}</a>
    </p>
    <p style="margin:0;font-family:${FONT_BODY};font-size:12.5px;line-height:1.6;color:${C.inkFaint};">
      This invite expires in ${Number(expiresDays) || 7} days.
      If you weren&rsquo;t expecting it, you can safely ignore this email.
    </p>`;
  return shell({ logoUrl, kicker: 'Guest care portal', bodyHtml });
}

module.exports = { inviteEmailHtml };
