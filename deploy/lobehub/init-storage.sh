#!/bin/sh
set -eu
rc alias set local http://storage:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
rc mb local/lobehub --ignore-existing >/dev/null
rc anonymous set private local/lobehub >/dev/null
printf '%s' "<CORSConfiguration><CORSRule><AllowedOrigin>${LOBE_PUBLIC_URL}</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>" | rc bucket cors set local/lobehub - >/dev/null
printf '%s\n' 'Private file bucket and restricted upload CORS configured.'
