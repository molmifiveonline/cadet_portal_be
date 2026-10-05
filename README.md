# cadet_portal_be
Cadet Portal BE

Set the backend `FRONTEND_URL` to the public portal URL, for example `https://cadet.molminavis.com`. If it contains a comma-separated list, put the public portal URL first; additional URLs are allowed CORS origins. Institute email links use this first URL with `/institute-login` and redirect to `/drives` after login. Set `INSTITUTE_LOGIN_URL` only when a separate institute login URL is required. Restart the backend after changing these environment settings.
