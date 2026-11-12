// The loading screen's words: things done in the world while the map loads, one every second and a half.
// A file, not an inline <script>: the Content-Security-Policy (public/sws.toml) allows no inline script.
(() => {
  const words = ['Sending ravens from the Citadel…', 'Unrolling the maesters’ maps…', 'Raising the Wall, block by block…', 'Lighting the beacon of the Hightower…', 'Riding the Kingsroad…', 'Crossing the Narrow Sea…', 'Following the Trident to the sea…', 'Waking the weirwoods…', 'Charting the Smoking Sea…', 'Forging links for the maesters’ chains…', 'Unfurling the banners of the great houses…', 'Crossing the Dothraki sea…', 'Counting the leagues of the Seven Kingdoms…', 'Gathering tales from the Free Cities…', 'Knocking at the House of Black and White…', 'Sharpening the dragonglass…', 'Feeding the ravens…', 'Opening the gates of Oldtown…'];
  const el = document.getElementById('loadMsg');
  let i = Math.floor(Math.random() * words.length);
  const next = () => { el.textContent = words[i++ % words.length]; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; };
  next();
  setInterval(next, 1500);
})();
