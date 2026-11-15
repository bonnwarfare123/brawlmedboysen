// INSTÄLLNINGAR – här justerar vi spelkänslan efter speltester.
// Ändra en siffra, ladda upp filen, och testa igen.

export const CONFIG = {
  // Rörelse (meter per sekund)
  walkSpeed: 3,            // vanlig fart (W)
  sprintSpeed: 5,          // sprint (Shift + W), kostar ork

  // Ork (stamina) – gäller bara sprint
  stamina: {
    max: 100,
    sprintSeconds: 6,      // så länge räcker full ork när man sprintar
    recoverSeconds: 4,     // så lång tid tar det att fylla på från noll till full
    recoverDelay: 0.75,    // paus efter avslutad sprint innan orken börjar komma tillbaka
    minAfterEmpty: 20,     // har orken tagit helt slut måste så här mycket komma tillbaka innan man kan sprinta igen
    lowAt: 25,             // under det här visas orken som låg
  },
  acceleration: 11,        // hur snabbt man kommer upp i fart / bromsar (högre = snabbare)
  airControl: 2.5,         // hur mycket man kan styra i luften

  // Hopp
  jumpSpeed: 5.5,          // hur högt man hoppar
  gravity: 18,

  // Strid (skada, räckvidd och väntetider finns i shared.js, eftersom servern behöver dem)
  holdForHeavy: 0.2,       // så länge man håller vänster musknapp innan det blir ett tungt slag
  chargeMoveFactor: 0.6,   // fart när man laddar ett tungt slag
  attackMoveFactor: 0.7,   // fart medan man slår
  staggerMoveFactor: 0.35, // fart när man blivit parerad

  // Kamera
  cameraDistance: 4.7,     // hur långt bakom riddaren
  cameraHeight: 1.68,      // höjden kameran siktar på
  cameraTilt: 0.3,         // hur mycket av musens upp/ner som lutar kameran i stället för att flytta den (0 = bara flytta, 1 = bara luta)
  aimScreenY: 0.46,        // var siktet sitter på skärmen uppifrån (0.5 = mitten)
  cameraShoulder: 0.6,     // förskjutning åt höger ("över axeln")
  mouseSensitivity: 0.0025,
  pitchMin: -0.5,          // hur långt ner man kan titta
  pitchMax: 0.9,           // hur långt upp man kan titta

  // Nätverk
  sendRate: 15,            // positionsuppdateringar per sekund (max)
  heartbeatSeconds: 1,     // skicka ändå så här ofta när man står still

  // Arena
  centerBarrier: false,    // tornerspelsbarriären i mitten (testa true/false)

  // Grafik
  fullscreen: true,        // helskärm när man klickar för att spela (behövs för att Ctrl ska kunna huka)
  shadows: true,
  maxPixelRatio: 1.5,      // högre = skarpare men tyngre (2 = full skärpa på högupplösta skärmar)
  shadowMapSize: 2048,     // skuggornas upplösning (Hög grafik)
  shadowMapSizeLow: 1024,  // (Låg grafik)
};
