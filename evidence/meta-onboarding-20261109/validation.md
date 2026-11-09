# Meta onboarding validation — 2026-11-09

Device: 192.168.0.121:5555, package com.botadmin.shop.

- Before: browser screenshot shows "Perfil Meta não encontrado" after Meta approval.
- Profile 666 exists and belongs to admin user 1. Browser completion returned 404 under its session.
- Start now issues an expiring signed context for the initiating account and exact profile. Browser completion uses this context independently of the browser's BotAdmin login.
- Isolated checks passed: mismatched browser account, tampered signature, changed instance ID, rejected cross-origin request, OAuth code followed by signup event, repeated signup event, native return and responsive HTML.
- Live scoped API checks passed: start 200, frame 200 under another account, profile recognized, unauthorized profile and invalid signature 403.
- Real Meta authorization completed for the registered Bot Admin phone ending 4443. POST /api/meta/onboarding/complete returned 200.
- Database: meta_connections instance 666, user 1, status connected; pending row for 666 removed.
- Live Graph verification returned ok=true, verified name Bot Admin.
- Superadmin message-center API returned metaConfigured=true, source=oauth.
- Coexistence history sync completed (100%); app-state sync requested.
- Browser external-scheme navigation was blocked in the standalone Chrome test. The APK now restores its activity after authenticated polling confirms that the requested profile completed onboarding. Manual return remains available.

Screenshots: before-profile-not-found.png, after-connected.png.
