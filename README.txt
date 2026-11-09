MATCH DEKHO — STREAMING-IMPROVED BUILD
=====================================
This update improves HLS startup, buffering, retries, media decoder recovery,
mobile playback setup, and error messages.

Important findings from the supplied HAR capture:
- The website loaded its India M3U playlist successfully (HTTP 200).
- The HLS.js library loaded successfully.
- The capture contains no request for a channel's .m3u8 manifest or video
  segments (.ts/.m4s). That means this capture does not show a channel playback
  attempt, so it cannot identify which specific channel is broken.
- Once a channel is tapped, the browser must be able to fetch its manifest and
  segments. Some public streams block third-party sites through CORS, region
  restrictions, expired URLs, referer checks, or broadcaster authorization.

Deploy the Match-Dekho folder to an HTTPS static host (Netlify, Cloudflare Pages,
or GitHub Pages). Do not open index.html as file://.

To diagnose a particular channel, open the deployed site, tap that channel,
wait for the error, and export a fresh HAR while the player is attempting to
load. Use only streams you are authorized to access. This project does not
bypass broadcaster access controls and cannot make an offline stream work.
