const PFLANZENSCHUTZ = {
  text: "Pflanzenschutz",
  children: [
    {
      text: "biotische Schadursachen",
      side: "right",
      color: "gold",
      children: [
        {
          text: "Insekten",
          children: [
            { text: "Wanzen" },
            { text: "Blattwespen" },
            {
              text: "Läuse",
              children: [{ text: "Blattläuse" }, { text: "Schildläuse" }],
            },
            { text: "Wollläuse" },
            { text: "Engerlinge", children: [{ text: "Buchsbaumzünsler" }] },
            { text: "Raupen", children: [{ text: "v. Schmetterlinge / Motten" }] },
            { text: "Zikade" },
            { text: "Blatt- und Erdföhe" },
            { text: "Thripse" },
          ],
        },
        {
          text: "Milben",
          children: [
            { text: "Weichhautmilben" },
            { text: "Gallmilben" },
            { text: "Spinnmilben" },
          ],
        },
        { text: "Vögel" },
        { text: "Schnecken" },
        { text: "Pilze" },
        { text: "Nagetiere" },
        { text: "Menschen" },
      ],
    },
    {
      text: "Schutzmaßnahmen + Bekämpfung",
      side: "right",
      color: "orange",
      children: [
        {
          text: "tech. / mech. / physik. Schutz",
          children: [{ text: "Flachs / Vlies" }, { text: "GWH" }, { text: "Netze" }],
        },
        { text: "kurativ = heilend" },
        { text: "Hygiene / Desinfektion" },
        {
          text: "thermische Verfahren",
          children: [{ text: "Dämpfen" }, { text: "Abflammen" }],
        },
        { text: "präventiv = vorbeugend" },
        {
          text: "Nützlinge",
          children: [
            { text: "Florfliegen" },
            { text: "Laufenten" },
            { text: "Nematoden" },
            { text: "Schlupfwespen" },
            { text: "Marienkäfer" },
            { text: "Raubwanzen" },
            { text: "Igel" },
            { text: "Raubmilben" },
          ],
        },
      ],
    },
    {
      text: "abiotische Schadursachen",
      side: "left",
      color: "green",
      children: [
        {
          text: "Bodeneigenschaften",
          children: [
            { text: "pH-Wert", children: [{ text: "hoher" }, { text: "niedriger" }] },
            { text: "Nährstoffüberschuss" },
            { text: "Nährstoffmangel" },
          ],
        },
        {
          text: "Witterung/Klima",
          children: [
            { text: "zu schattig" },
            { text: "Frost" },
            { text: "Sauerstoffmangel" },
            { text: "Staunässe" },
            { text: "Trockenheit" },
            { text: "Hitze" },
          ],
        },
      ],
    },
    {
      text: "Pfl. Schutzmittel = Pestizide",
      side: "left",
      color: "cyan",
      children: [
        { text: "Herbizide = Unkrautkiller" },
        { text: "Akarizide -> gegen Milben" },
        { text: "Rodentizide -> vs. Nagetiere" },
        { text: "Fungizide = Pilzkiller" },
        { text: "Molluskizide -> geg. Schnecken" },
        {
          text: "Wirkmechanismen",
          children: [{ text: "Kontaktgifte" }, { text: "Fraßgifte" }, { text: "Atemgifte" }],
        },
        {
          text: "Im ökol. Landbau Mittel zugelassene",
          children: [
            { text: "Brennnesseljauche" },
            { text: "Neemöl" },
            { text: "Schwefel" },
            { text: "Kupfer" },
            { text: "Kaliseife" },
            { text: "Rapsöl" },
            { text: "Bacillus thuringiensis" },
            { text: "Pyrethrine" },
            { text: "Eisen-III-Phosphat" },
            { text: "Schachtelhalm-Extrakt" },
            { text: "Kaliumhydrogencarbonat" },
            { text: "Spinosad" },
          ],
        },
      ],
    },
    {
      text: "pflanzeneigene Mechanismen",
      side: "left",
      color: "blue",
      children: [
        {
          text: "physikalischer Schutz",
          children: [
            { text: "Dornen / Stacheln" },
            { text: "Cuticula = Wachsschicht d. Haut" },
            { text: "Rinde" },
          ],
        },
        {
          text: "chemischer Schutz",
          children: [{ text: "Terpene" }, { text: "Gifte (Alkaloide)" }],
        },
      ],
    },
  ],
};
