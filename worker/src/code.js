// Sync-code per persoon, zoals panda-mango-wolk-47: drie woorden uit een vaste
// lijst en twee cijfers. De app maakt de code (crypto-random); de worker
// alleen bij de eenmalige overstap van het oude wachtwoord (/migreer).
// Bij de voortgang bewaart de server nooit de code zelf, alleen
// sha256(code) als sleutel: persoon:<hash>.
//
// De woorden: korte, bekende Nederlandse woorden van 3 tot 6 letters,
// alleen a tot z en zonder c, q, x, y en ij (lastig voor een kind om te
// spellen). 1052 woorden, dus 1052^3 x 100, ongeveer 1,2e11 codes.
//
// Dezelfde lijst staat in index.html (CODE_WOORDEN). Pas ze samen aan; een
// pariteitstest (tests/code.test.mjs) vergelijkt ze.

export const CODE_WOORDEN = (
  "aap aarde adder adem agent akker alarm alpen amber angel anker appel april arend ark arm aster " +
  "atlas augurk auto avond baai baal baan baard bad badge badjas bagel bak baken bakker bal balk " +
  "balkon ballon balsem bamboe banaan band banjo bank bar baret baron basalt basis bazaar bed beek " +
  "beeld beer beest beet beige beitel beker bel bende berg berk berm bes beuk beurs bever bezem " +
  "bezoek bidon bies biet binnen bizon blaas blad blauw blauwe blazer bliep blik bloem bloes blok " +
  "blos bobbel bodem boei boek boeket boer bok bokaal boks bolder boleet bon bonbon bonk bonte boog " +
  "boom boon boor boot bord bos bosbes bosje bot boter bout bouw boven braaf braam brem brief bries " +
  "bril broed broek broer brok bron brons brood brouw brug bruid bruin brul bubbel buffel buffet " +
  "bui buidel buis bult bus buur buurt dadel dag dahlia dak dal dam damp dans das dauw deeg deken " +
  "delta dennen derde deuk deur diep dier dimmer dingo dino diva dobber dok dokter dol domino " +
  "donder dons donut dooi doorn doos dop dorp dorst dot draad draai draak draf dragon drank drie " +
  "droom drop druif drup dubbel duet duif duik duim duin dukaat duo dweil dwerg eend eer egel eik " +
  "eiland eind ekster eland elf elfje emmer emoe engel enkel erwt ezel fabel fagot fakkel fazant " +
  "fee feest feniks fiets film fjord flap fles flits floep flora fluit foef folder fondue fonkel " +
  "fooi forel fort foto frank frase fregat fret fris fruit fuut gaai gaas galop gamba gang gans " +
  "garen gast gat gazon gebak geest geit gel geld gelei geluk gember geraas gerst gesp getal geur " +
  "gewei gids gier gilde gips giraf gitaar glans glas glimp globe gloed gloei gnoe golf gondel gong " +
  "gort goud gouden graaf graan grap gras gravel greep griep gril grind groen groep groet grond " +
  "grot guit gulden gum haag haai haak haan haar haard haas hagel hak hal halm halte hamer hand " +
  "haring harnas harp hart haven haver havik hazel heelal heer heg heide hek held helm hemd hemel " +
  "hen hengel herder herfst hert heuvel hiel hinde hoed hoef hoek hoepel hoera hoes hok hol hommel " +
  "homp hond honing honk hoofd hooi hoop hoorn hop horde horen hotel hout huis hulp hulst humor " +
  "humus hut ibis idee iglo imker impala inkt iris ivoor jaar jade jager jaguar jam jas jazz jeep " +
  "jet jeugd jodel jojo joker jolig jong juf juli jumbo juni junior jurk juweel kaai kaak kaap " +
  "kaars kaart kaas kabaal kabel kade kaft kajak kalf kalk kam kameel kamer kamp kan kanaal kaneel " +
  "kano kant kap kapel kapok kapper kar karaf karate karper karton kas kassa kast kat katoen kauw " +
  "keel kei keizer kelder kennel kermis kers kerst ketel kever kiekje kievit kiezel kikker kimono " +
  "kind kiosk kip klant klap klaver klei klepel kleur klimop klok klomp kluis knaap knal knie knol " +
  "knoop knop koala koe koek koekje koepel koets koffer kok kolder kom komeet komma kompas koning " +
  "kooi kool koor koord kop koper kopje koraal korf korrel korset korst kotter kous kraag kraai " +
  "kraan krab kralen krant krat kreeft kreek krekel krent kring kroon kruid kruik kruk krul kubus " +
  "kudde kuiken kuil kuip kunst kurk kust kwal kwart kwast kwiek laag laan laars ladder lading lak " +
  "laken lam lama lamp land lap lasso lat later lava leder leem leeuw lelie lente lepel leraar les " +
  "letter lezer libel lied liefde lier limoen linde links linnen lint linze lippen liter lobbes " +
  "loep lof lok loods loop loper lotus luik luis lus luwte maan maand maart maat mais mama mand " +
  "manege mangel mango mantel markt marmer marmot mars marter masker mast mat matras meer mees " +
  "meeuw melk meloen mentor menu merel merk mes metaal meter middag mier minuut mist modder moeras " +
  "mok mokka mol molen mond moot morgen mos mossel mot motor mousse mug muis munt mus museum muts " +
  "muur muziek naald naam nagel nar narwal natuur neef nerts nest net neus nevel nimf noord noot " +
  "nougat nul oase ober oehoe oever ogen okapi oktaaf olie oma omelet oog oogst oor oost opa opaal " +
  "opera oranje orgel orka orkest otter ouder ovaal oven paal paard paars pad pagina pak pakje " +
  "pakket paleis palet paling pallet palm pampa pan panda panter pap papa papier parel parfum park " +
  "parka parket pas pasen pasta pastei pastel patat patio pauw pauze pedaal peen peer pen peper " +
  "perzik pet piano piek pier piloot pimpel pinda pioen pion piraat pit pizza plaid plank plant " +
  "plas plein ploeg pluim pluk poeder poef poema poes polder polka pollen pols pomp pond poort poot " +
  "pop post poster pot praam prei prent presto pret prik prins proef prooi pruik pruim puree put " +
  "puzzel raad raaf raam rad radar radio rail raket rakker rand reep regen reiger reis rente reus " +
  "ribbel ridder riem riet rietje rif ring rit rivier rob robot rodeo roer rok rol rond ronde room " +
  "roos roosje rotan rots rover roze rubber rug rugzak ruimte ruit ruiter rumba rund rups rust " +
  "salade salie salto samba sap saus sein sering sesam sinas sirene sjaal slaap slak slang slee " +
  "slot sluis slurf smaak smid smurf snaar snavel snee sneeuw snert snoek snoep snoet snor soep " +
  "sofa sok solo sonnet sorbet spade spar spek spel speld spin spits spons spoor sport sprei sprint " +
  "sprong staart stad stal stam stapel ster stier stip stoel stoep stof stok stoom storm stout " +
  "straat strand streep strik stro stroom stuur suiker taart tafel tak talent tand tang tango tapir " +
  "tarwe tas team teen tegel tekst tempo tennis tent thee tiara timmer toast toekan toets tomaat " +
  "ton toon top topaas toren touw tram trap trein trofee trom trui tuba tube tuin tulp tunnel turf " +
  "uil unie uur vaas vader vak valk valkje van vanger varken vat veder veer veld velg ven verf vest " +
  "veter veulen video vin vinger viool vis visser vizier vla vlaai vlag vlam vlek vlieg vloot vlot " +
  "voet vogel volk vonk vork vos vrede vriend vuist vuur waaier wafel wagen wal walrus wand wandel " +
  "wang want warmte water web weg wei weide wereld werk wesp wezel wiebel wieg wiek wiel wier " +
  "wigwam wild wilg wind winter wol wolf wolk wombat woning woord worm worst wortel woud wrak zaad " +
  "zaag zadel zak zalm zand zebra zee zeef zeep zegel zeil zeker zeven zilver zoemer zoet zomer zon " +
  "zondag zonnig zool zout zuivel zus zuster zwaan zwaluw zwam"
).split(" ");

const WOORDSET = new Set(CODE_WOORDEN);
// De vorm. geldigeCode() kijkt daarnaast of de woorden in de lijst staan.
export const CODE_VORM = /^([a-z]{3,6})-([a-z]{3,6})-([a-z]{3,6})-([0-9]{2})$/;
export const CODE_MAX = 23; // 3 x 6 letters, 2 cijfers, 3 streepjes

export function geldigeCode(code) {
  if (typeof code !== "string" || code.length > CODE_MAX) return false;
  const m = CODE_VORM.exec(code);
  return !!m && WOORDSET.has(m[1]) && WOORDSET.has(m[2]) && WOORDSET.has(m[3]);
}

// Gelijk verdeeld getal van 0 tot n: wat boven het laatste volle veelvoud
// van n valt, gooien we weg, zodat geen woord vaker voorkomt.
function willekeurig(n) {
  const grens = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < grens) return buf[0] % n;
  }
}

export function maakCode() {
  const w = () => CODE_WOORDEN[willekeurig(CODE_WOORDEN.length)];
  return w() + "-" + w() + "-" + w() + "-" + String(willekeurig(100)).padStart(2, "0");
}

// sha256 als 64 tekens hex, kleine letters.
export async function codeHash(code) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
