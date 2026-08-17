// Built-in privacy policy text, in the light markdown the policy pages render
// (## heading · - bullet · **bold** · *italic* · [label](url)). Settings →
// Content → Privacy pages stores an override in content.privacy.{guest,staff};
// an empty override means "use this built-in text". Keep this file honest: it
// describes what the code actually does, so when a data practice changes,
// change the matching section here (and the date) in the same commit.

export const DEFAULT_POLICY = {
  guest: {
    updated: 'August 17, 2026',
    body: `WoodsVoice is Muskoka Woods’ guest care portal — the QR codes around camp and the form at woodsvoice.com. This page explains what happens to the information you share when you send us a note. Staff and volunteer accounts are covered by the separate [staff privacy notice](/privacy/staff).

## The short version

- Unless a field is marked *required* on the form, everything except your message is optional — you can send a note without telling us who you are.
- What you share is used to look after you and your group, never for advertising or marketing.
- We don’t sell your information, and we don’t use advertising trackers or third-party analytics.

## What you send us

- **Your message** — the only thing that’s always required.
- **Choices you make on the form** — the kind of note, how urgent it feels, a category, and a location (picked from the list, or filled in automatically when you scan a QR sign).
- **Contact details, if you add them** — name, school or group, email, phone. These let us follow up with you directly.
- **An email for updates, if you ask for them** — after sending a note (or from its tracking page) you can leave an email address to get progress emails about that note.
- **A photo, if you attach one.**
- **How and when the note arrived** — whether the form was opened from a QR sign, a kiosk, or the web, and the time it was sent.

## What’s collected automatically

- **Visit counts.** When the form is opened we count the visit so the team knows which QR signs get used. The count uses a scrambled one-way code built from your internet address, browser, and the date — your actual internet address and browser details are never stored, and the code changes every day, so it can’t be used to identify or follow you.
- **Saved details on your own device.** If you add contact details, your browser remembers them so you don’t retype them for the next note. That information stays on your device — it isn’t sent anywhere until you submit a note, shared kiosk screens never save it, and *Clear saved details* on the form removes it.
- **Your submissions, on your own device.** After you send a note, your browser keeps a private reference to it (with a short preview of your message) so you can check its progress later without a code — just reopen the form and tap *My submissions*. This list stays on your device, shared kiosk screens never keep it, and clearing your browsing data removes it.
- **No trackers.** The guest form sets no advertising or analytics cookies.

## How we use your note

- **Getting it to the right people** — notes are routed to the team responsible for the category and location.
- **Sorting.** Sorting happens in Muskoka Woods’ central Report-A-Problem system, where an AI reads your message to suggest a category, an urgency, and a one-line summary for staff. It’s used only to sort your note.
- **Following up** — if you shared contact details, the team may use them to reach you about your note.
- **Update emails, if you asked for them** — an address left for updates is used only to email you as that note moves along, never for anything else. You can stop the emails anytime from the note’s tracking page.
- **Improving guest care** — ratings, visit counts, and response times are reviewed in aggregate to see how we’re doing.

## Where your note goes

- **Muskoka Woods’ central Report-A-Problem system.** This is where your note lives and where the camp team actually works on it. Your full note — including any contact details and photo you chose to share — is delivered there right after you send it. It’s run by Muskoka Woods, not a third party.
- **Muskoka Woods guest care staff.** The portal shows staff a read-only view of the central system’s tickets. Access is permission-based — staff see the departments they work in.
- **Infrastructure.** The portal runs on Muskoka Woods’ own servers, with traffic to woodsvoice.com protected by Cloudflare. Photos are stored at a hard-to-guess address on our server so they can be shared with the teams above. The portal also keeps a delivery record of your note (so your tracking code, update emails, and rating keep working) alongside its synced copy of the central system’s tickets.

## Your tracking code

After you send a note you get a code like **MW-XXXXXX**. It works like a claim ticket: anyone who has the code can see the note’s status, category, location, a short preview of your message, and any messages the team writes back for you — and can leave a rating once it’s resolved, or turn email updates for the note on or off. The tracker never shows your contact details or the email address updates go to. Treat the code like a ticket stub and share it only with your group.

## How long we keep it

Notes are kept in the central Report-A-Problem system as guest care records so the team can spot patterns between seasons and improve; the portal keeps its delivery records, photos, and ratings alongside. If you’d like something you sent to be corrected or removed, just ask — we can find it fastest if you have your tracking code.

## Young guests

Many of our guests are young people. The form only ever asks for what’s needed to help — a message on its own is always enough, and leaders are welcome to send notes on their group’s behalf.

## Changes & questions

If our practices change, we’ll update this page and the date at the top. Questions, or a request to see, correct, or delete your information? Speak with any Muskoka Woods staff member, or reach the team through [muskokawoods.com](https://muskokawoods.com).`,
  },

  staff: {
    updated: 'August 17, 2026',
    body: `This notice covers staff and volunteer accounts on WoodsVoice — the admin side of Muskoka Woods’ guest care portal. What guests share with us is covered by the [guest privacy policy](/privacy).

## Your account

Your account stores your display name, email, username, role, and the departments you belong to. If you use a password it’s stored only as a one-way hash — nobody, including administrators, can read it back. If you sign in with Google, we store Google’s stable account identifier instead of a password.

## Google sign-in

Signing in with Google shares only your identity with us: your name, your email address, and Google’s account identifier. WoodsVoice gets no access to your Gmail, Drive, or anything else in your Google account, and never sees your Google password.

## Invites

Before you accept an invite, the portal holds your email address and intended role. The invite link’s token is stored hashed, invites expire after 7 days, and administrators can revoke a pending invite at any time.

## Sessions

Signing in stores a signed session token in your browser. It expires after 12 hours, and signing out removes it. The admin side sets no advertising or analytics cookies.

## Your activity

The portal’s inbox is a read-only window — ticket work happens in Muskoka Woods’ central Report-A-Problem system, which keeps its own history of who did what. The portal syncs and displays that history to staff with access.

## Emails

The portal emails you when you’re invited.

## Who can see your details

Team managers (anyone with the *manage users* permission) can see your name, email, role, and departments. Other staff see your display name where you’ve acted on a submission.

## Leaving the team

Deactivating an account stops sign-in immediately. Deleting an account removes it along with its sign-in identity; timeline entries stay part of the guest care record and may still mention your name in their text.

## Questions

Talk to your team lead or the WoodsVoice administrator — they can update or remove your details.`,
  },
};
