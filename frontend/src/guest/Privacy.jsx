import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { applyTheme } from '../theme';

// Privacy pages. Both live on the guest surface so they're readable without an
// account — the staff notice matters most before someone accepts an invite.
// Wording is grounded in what the code actually does; if a data practice
// changes (new integration, new field), update the matching section here.

const EFFECTIVE = 'August 14, 2026';

function PolicyShell({ kicker, title, children }) {
  const [config, setConfig] = useState(null);

  useEffect(() => {
    api.publicConfig()
      .then(cfg => { setConfig(cfg); applyTheme(cfg.content?.branding); })
      .catch(() => setConfig({}));
    window.scrollTo({ top: 0 });
  }, []);

  const branding = config?.content?.branding || {};
  const orgName = config?.general?.orgName || 'Muskoka Woods';

  return (
    <div className="guest-shell">
      <header className="guest-top rise">
        <Link to="/"><img src={branding.logoLight || '/brand/mw-logo-white.png'} alt={orgName} /></Link>
      </header>

      <section className="guest-hero rise rise-1">
        <div className="kicker">{kicker}</div>
        <h1 className="display">{title}</h1>
      </section>

      <main className="guest-card policy rise rise-2">
        <p className="policy-date">Last updated {EFFECTIVE}</p>
        {children}
      </main>

      <footer className="guest-foot rise rise-3">
        <span>© {new Date().getFullYear()} {orgName}</span>
        <span className="guest-foot__links">
          <Link to="/">← Back to the form</Link>
        </span>
      </footer>
    </div>
  );
}

export function GuestPrivacy() {
  return (
    <PolicyShell kicker="Your privacy" title="Privacy policy">
      <p>
        WoodsVoice is Muskoka Woods&rsquo; guest care portal — the QR codes around
        camp and the form at woodsvoice.com. This page explains what happens to
        the information you share when you send us a note. Staff and volunteer
        accounts are covered by the separate <Link to="/privacy/staff">staff privacy notice</Link>.
      </p>

      <h2>The short version</h2>
      <ul>
        <li>Unless a field is marked <em>required</em> on the form, everything except your message is optional — you can send a note without telling us who you are.</li>
        <li>What you share is used to look after you and your group, never for advertising or marketing.</li>
        <li>We don&rsquo;t sell your information, and we don&rsquo;t use advertising trackers or third-party analytics.</li>
      </ul>

      <h2>What you send us</h2>
      <p>A note can include:</p>
      <ul>
        <li><strong>Your message</strong> — the only thing that&rsquo;s always required.</li>
        <li><strong>Choices you make on the form</strong> — the kind of note, how urgent it feels, a category, and a location (picked from the list, or filled in automatically when you scan a QR sign).</li>
        <li><strong>Contact details, if you add them</strong> — name, school or group, email, phone. These let us follow up with you directly.</li>
        <li><strong>A photo, if you attach one.</strong></li>
        <li><strong>How and when the note arrived</strong> — whether the form was opened from a QR sign, a kiosk, or the web, and the time it was sent.</li>
      </ul>

      <h2>What&rsquo;s collected automatically</h2>
      <ul>
        <li><strong>Visit counts.</strong> When the form is opened we count the visit so the team knows which QR signs get used. The count uses a scrambled one-way code built from your internet address, browser, and the date — your actual internet address and browser details are never stored, and the code changes every day, so it can&rsquo;t be used to identify or follow you.</li>
        <li><strong>Saved details on your own device.</strong> If you add contact details, your browser remembers them so you don&rsquo;t retype them for the next note. That information stays on your device — it isn&rsquo;t sent anywhere until you submit a note, shared kiosk screens never save it, and <em>Clear saved details</em> on the form removes it.</li>
        <li><strong>No trackers.</strong> The guest form sets no advertising or analytics cookies.</li>
      </ul>

      <h2>How we use your note</h2>
      <ul>
        <li><strong>Getting it to the right people</strong> — notes are routed to the team responsible for the category and location.</li>
        <li><strong>Sorting.</strong> The text of your message may be processed by an AI service to suggest a category, an urgency, and a one-line summary for staff. Depending on how the portal is configured this is Anthropic&rsquo;s Claude service or a model running on Muskoka Woods&rsquo; own servers; either way it&rsquo;s used only to sort your note.</li>
        <li><strong>Following up</strong> — if you shared contact details, the team may use them to reach you about your note.</li>
        <li><strong>Improving guest care</strong> — ratings, visit counts, and response times are reviewed in aggregate to see how we&rsquo;re doing.</li>
      </ul>

      <h2>Where your note goes</h2>
      <ul>
        <li><strong>Muskoka Woods guest care staff.</strong> Access inside the portal is permission-based — staff see the departments they work in.</li>
        <li><strong>Muskoka Woods&rsquo; central Report-A-Problem system.</strong> Your full note — including any contact details and photo you chose to share — is handed off to the central system where the camp team actually works on tickets. It&rsquo;s run by Muskoka Woods, not a third party.</li>
        <li><strong>Staff notification emails.</strong> New notes trigger an email to the responsible team with a summary, the location, and the name and group if you gave them.</li>
        <li><strong>Infrastructure.</strong> The portal runs on Muskoka Woods&rsquo; own servers, with traffic to woodsvoice.com protected by Cloudflare. Photos are stored at a hard-to-guess address on our server so they can be shared with the teams above.</li>
      </ul>

      <h2>Your tracking code</h2>
      <p>
        After you send a note you get a code like <strong>MW-XXXXXX</strong>. It works
        like a claim ticket: anyone who has the code can see the note&rsquo;s status,
        category, location, and the public updates staff post — and can leave a
        rating once it&rsquo;s resolved. The tracker never shows your message or your
        contact details. Treat the code like a ticket stub and share it only with
        your group.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Notes, photos, and ratings are kept as guest care records so the team can
        spot patterns between seasons and improve. If you&rsquo;d like something you
        sent to be corrected or removed, just ask — we can find it fastest if you
        have your tracking code.
      </p>

      <h2>Young guests</h2>
      <p>
        Many of our guests are young people. The form only ever asks for what&rsquo;s
        needed to help — a message on its own is always enough, and leaders are
        welcome to send notes on their group&rsquo;s behalf.
      </p>

      <h2>Changes &amp; questions</h2>
      <p>
        If our practices change, we&rsquo;ll update this page and the date at the top.
        Questions, or a request to see, correct, or delete your information?
        Speak with any Muskoka Woods staff member, or reach the team through{' '}
        <a href="https://muskokawoods.com" target="_blank" rel="noreferrer">muskokawoods.com</a>.
      </p>
    </PolicyShell>
  );
}

export function StaffPrivacy() {
  return (
    <PolicyShell kicker="For the team" title="Staff privacy notice">
      <p>
        This notice covers staff and volunteer accounts on WoodsVoice — the admin
        side of Muskoka Woods&rsquo; guest care portal. What guests share with us is
        covered by the <Link to="/privacy">guest privacy policy</Link>.
      </p>

      <h2>Your account</h2>
      <p>
        Your account stores your display name, email, username, role, and the
        departments you belong to. If you use a password it&rsquo;s stored only as a
        one-way hash — nobody, including administrators, can read it back. If you
        sign in with Google, we store Google&rsquo;s stable account identifier instead
        of a password.
      </p>

      <h2>Google sign-in</h2>
      <p>
        Signing in with Google shares only your identity with us: your name, your
        email address, and Google&rsquo;s account identifier. WoodsVoice gets no access
        to your Gmail, Drive, or anything else in your Google account, and never
        sees your Google password.
      </p>

      <h2>Invites</h2>
      <p>
        Before you accept an invite, the portal holds your email address and
        intended role. The invite link&rsquo;s token is stored hashed, invites expire
        after 7 days, and administrators can revoke a pending invite at any time.
      </p>

      <h2>Sessions</h2>
      <p>
        Signing in stores a signed session token in your browser. It expires
        after 12 hours, and signing out removes it. The admin side sets no
        advertising or analytics cookies.
      </p>

      <h2>Your activity</h2>
      <p>
        Actions you take on a submission — status changes, assignments, notes,
        forwards — are recorded on that submission&rsquo;s timeline under your name.
        These entries are part of the guest care record: they&rsquo;re visible to other
        staff with access to the submission, and entries marked public are shown
        to the guest who holds the tracking code.
      </p>

      <h2>Emails</h2>
      <p>
        The portal emails you when you&rsquo;re invited, and sends submission
        notifications to department addresses and on-call assignees.
      </p>

      <h2>Who can see your details</h2>
      <p>
        Team managers (anyone with the <em>manage users</em> permission) can see
        your name, email, role, and departments. Other staff see your display
        name where you&rsquo;ve acted on a submission.
      </p>

      <h2>Leaving the team</h2>
      <p>
        Deactivating an account stops sign-in immediately. Deleting an account
        removes it along with its sign-in identity; timeline entries stay part of
        the guest care record and may still mention your name in their text.
      </p>

      <h2>Questions</h2>
      <p>
        Talk to your team lead or the WoodsVoice administrator — they can update
        or remove your details.
      </p>
    </PolicyShell>
  );
}
