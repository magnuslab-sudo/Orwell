# Security

If you found a way to break Orwell, thank you for looking. Please tell me
before you tell anyone else.

## How to report

Write to **orwell.eu@proton.me**, in English or in Portuguese.

Please do not open a public issue for anything that would let somebody read
messages they should not read, act as another account, reach another user's
data, or take over a homeserver. Anything else is fine in the open.

A good report says what you did, what you expected, what happened instead, and
which version you used. A short script or a list of steps helps more than a long
explanation.

## What to expect

| | |
|---|---|
| I acknowledge your report | within 72 hours |
| First assessment | within 7 days |
| A fix, or a clear decision not to fix, with the reason | within 90 days |

If you hear nothing within 72 hours, assume the mail got lost and write again.
It was not ignored.

If your report leads to a change, I will credit you in the release notes,
unless you prefer not to be named. There is no bug bounty. This is a small
project, and I would rather say so than waste your time.

## In scope

The protocol, the cryptography, the homeserver, the browser and desktop apps,
the site at orwell.pt, and the deployment configuration in `infra/`.

What matters most, roughly in this order:

- Anything that lets the server, a peer server or someone on the network read
  message content, or learn who talks to whom beyond what
  [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) already admits.
- Anything that lets an account into a channel it was never admitted to, or lets
  it act as another account or another device.
- Anything that destroys data, especially through membership changes. Removing
  and re-adding a member cannot be undone, because forward secrecy takes their
  earlier history with it.
- Reuse of a nonce, a key or a counter, in the call media or in the vault.
- Anything in the report flow that exposes more than the person reporting chose
  to hand over.

## Out of scope

These are known, written down in the threat model, and accepted for now.
Reporting them is not a finding. If you think the reasoning behind one of them
is wrong, I want to hear that argument.

- **Code running as you on your own device.** If an attacker can run code as
  you while your account is open, they can read your messages, because your
  device has to be able to read them.
- **A member of a channel you let in.** They can take screenshots and share what
  they see. Encryption does not control other people's memories.
- **What the server sees by design.** Which opaque channel an account is in,
  when it is connected, IP addresses, message sizes (padded to at least 512 bytes),
  times to the minute, who is in a call with whom, and how many devices an
  account has. Hiding which channels you are in would need private information
  retrieval, which is not built.
- **Traffic analysis by someone who watches every link.** Messages are padded
  and times are rounded, but there is no cover traffic.
- **No account recovery.** There is none on purpose. A recovery flow means the
  service holds something that gives your access back, which is exactly what
  this project tries not to hold.
- **The browser keeps the identity key in the page.** There is nowhere else to
  put it. The desktop app keeps it out of the renderer.
- **Unsigned installers and no reproducible builds yet.** Both are known gaps,
  listed in the README.

## Disclosure

I will not take legal action against you for research done in good faith, and I
will not ask you to stay quiet forever. Give me the 90 days, or less if the fix
ships sooner, and then publish what you like.

If the flaw is being exploited right now, say so in the first line of your
mail. I will treat it as urgent, ahead of the timelines above.

## Thank you

Every serious report makes Orwell safer for the people who use it. Thank you
for the time it took to find it, and for telling me first.
