// Sleutel voor de tempogrens per IP. Los bestand: index.js mag alleen de
// handler en FotoTeller exporteren.

// IPv4 zoals het is. IPv6 als het /64-prefix: een aansluiting krijgt vaak
// een heel /64, en anders telt elk adres daarin apart.
export function ipSleutel(ip) {
  const s = String(ip || "").trim().toLowerCase();
  if (!s) return "onbekend";
  if (!s.includes(":")) return s;
  const zonderZone = s.split("%")[0];
  // IPv4 achter een IPv6-voorvoegsel (::ffff:1.2.3.4): het IPv4-adres
  const v4 = zonderZone.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) return v4[1];
  const [links, rechts] = zonderZone.includes("::") ? zonderZone.split("::") : [zonderZone, null];
  const l = links ? links.split(":") : [];
  const r = rechts === null ? [] : (rechts ? rechts.split(":") : []);
  const nullen = rechts === null ? [] : Array(Math.max(0, 8 - l.length - r.length)).fill("0");
  const delen = l.concat(nullen, r).slice(0, 8);
  if (delen.length < 4 || delen.some((d) => !/^[0-9a-f]{1,4}$/.test(d))) return "ongeldig";
  return delen.slice(0, 4).map((d) => d.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}
