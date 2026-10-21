// INSTÄLLNINGAR – här justerar vi spelkänslan efter speltester.
// Ändra en siffra, ladda upp filen, och testa igen.

export const CONFIG = {
  // Rörelse (meter per sekund)
  walkSpeed: 4,
  runSpeed: 6.5,

  // Hopp
  jumpSpeed: 5.5,          // hur högt man hoppar
  gravity: 18,

  // Strid (skada, räckvidd och väntetider finns i shared.js, eftersom servern behöver dem)
  holdForHeavy: 0.2,       // så länge man håller vänster musknapp innan det blir ett tungt slag
  chargeMoveFactor: 0.6,   // fart när man laddar ett tungt slag
  attackMoveFactor: 0.7,   // fart medan man slår
  staggerMoveFactor: 0.35, // fart när man blivit parerad

  // Kamera
  cameraDistance: 5,       // hur långt bakom riddaren
  cameraHeight: 1.6,       // höjden kameran siktar på
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
  shadows: true,
  maxPixelRatio: 1.5,      // högre = skarpare men tyngre (2 = full skärpa på högupplösta skärmar)
  shadowMapSize: 1024,     // skuggornas upplösning
};
