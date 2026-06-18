# QwertyLock hosted API

QwertyLock creates encrypted message links with limited uses and expiration. Encryption and decryption happen in the browser; the hosted service stores encrypted blocks and random message identifiers.

## Public endpoints

- `POST /api/qwertylock/messages`: store an encrypted message block.
- `GET /api/qwertylock/messages/:id`: retrieve an available encrypted block.
- `POST /api/qwertylock/messages/:id/consume`: record a successful use.
- `GET /api/health`: service availability.

The shared phrase and plaintext stay in the browser. Encrypted blocks are deleted after their allowed uses or expiration. Anyone with a link and its phrase can read the message while it remains available; share the phrase separately.

New messages use authenticated `QLR2` blocks; older `QLR1` links remain supported.

[Open QwertyLock](https://slendystuff.com/r/) · [Privacy information](https://slendystuff.com/qwertylock-privacy.html)

Authenticated administration reports aggregate usage and timing metadata; it does not return message content, phrases or identifiers.
