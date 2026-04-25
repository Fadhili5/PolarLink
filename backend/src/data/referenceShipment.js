export const referenceShipment = {
  "https://onerecord.iata.org/ns/api#hasRevision": 0,
  "@type": ["https://onerecord.iata.org/ns/cargo#Shipment"],
  "@id":
    "https://champ-onerecord.germanywestcentral.cloudapp.azure.com/api/TRAXON/logistics-objects/009d53e7-ebbe-3623-a1f1-aaf11efc011f",
  "https://onerecord.iata.org/ns/cargo#pieces": [
    {
      "@type": ["https://onerecord.iata.org/ns/cargo#Piece"],
      "@id":
        "https://champ-onerecord.germanywestcentral.cloudapp.azure.com/api/TRAXON/logistics-objects/4fc7b479-7d55-3ca4-ad3e-c02c90b97310",
      "https://onerecord.iata.org/ns/cargo#goodsDescription": "CONSOLIDATION",
      "https://onerecord.iata.org/ns/cargo#skeletonIndicator": true,
      "https://onerecord.iata.org/ns/cargo#specialHandlingCodes": [
        { "@id": "https://onerecord.iata.org/ns/code-lists/SpecialHandlingCode#ECC" },
        { "@id": "https://onerecord.iata.org/ns/code-lists/SpecialHandlingCode#VUN" },
        { "@id": "https://onerecord.iata.org/ns/code-lists/SpecialHandlingCode#EAP" },
        { "@id": "https://onerecord.iata.org/ns/code-lists/SpecialHandlingCode#ELI" },
      ],
      "https://onerecord.iata.org/ns/cargo#dimensions": {
        "@type": ["https://onerecord.iata.org/ns/cargo#Dimensions"],
        "https://onerecord.iata.org/ns/cargo#width": {
          "@type": ["https://onerecord.iata.org/ns/cargo#Value"],
          "https://onerecord.iata.org/ns/cargo#numericalValue": "64",
          "https://onerecord.iata.org/ns/cargo#unit": {
            "@id": "https://vocabulary.uncefact.org/UnitMeasureCode#CMT",
          },
        },
        "https://onerecord.iata.org/ns/cargo#height": {
          "@type": ["https://onerecord.iata.org/ns/cargo#Value"],
          "https://onerecord.iata.org/ns/cargo#numericalValue": "53",
          "https://onerecord.iata.org/ns/cargo#unit": {
            "@id": "https://vocabulary.uncefact.org/UnitMeasureCode#CMT",
          },
        },
        "https://onerecord.iata.org/ns/cargo#length": {
          "@type": ["https://onerecord.iata.org/ns/cargo#Value"],
          "https://onerecord.iata.org/ns/cargo#numericalValue": "84",
          "https://onerecord.iata.org/ns/cargo#unit": {
            "@id": "https://vocabulary.uncefact.org/UnitMeasureCode#CMT",
          },
        },
      },
    },
    {
      "@type": ["https://onerecord.iata.org/ns/cargo#Piece"],
      "@id":
        "https://champ-onerecord.germanywestcentral.cloudapp.azure.com/api/TRAXON/logistics-objects/4b7a2e12-7c1f-3224-85b1-5f56763db2b1",
      "https://onerecord.iata.org/ns/cargo#goodsDescription": "CONSOLIDATION",
      "https://onerecord.iata.org/ns/cargo#skeletonIndicator": true,
      "https://onerecord.iata.org/ns/cargo#dimensions": {
        "@type": ["https://onerecord.iata.org/ns/cargo#Dimensions"],
        "https://onerecord.iata.org/ns/cargo#width": {
          "@type": ["https://onerecord.iata.org/ns/cargo#Value"],
          "https://onerecord.iata.org/ns/cargo#numericalValue": "63",
        },
        "https://onerecord.iata.org/ns/cargo#height": {
          "@type": ["https://onerecord.iata.org/ns/cargo#Value"],
          "https://onerecord.iata.org/ns/cargo#numericalValue": "52",
        },
        "https://onerecord.iata.org/ns/cargo#length": {
          "@type": ["https://onerecord.iata.org/ns/cargo#Value"],
          "https://onerecord.iata.org/ns/cargo#numericalValue": "83",
        },
      },
    },
    {
      "@type": ["https://onerecord.iata.org/ns/cargo#Piece"],
      "@id":
        "https://champ-onerecord.germanywestcentral.cloudapp.azure.com/api/TRAXON/logistics-objects/8897a31b-bf2b-32b1-a09d-e3026e36f734",
      "https://onerecord.iata.org/ns/cargo#goodsDescription": "CONSOLIDATION",
      "https://onerecord.iata.org/ns/cargo#skeletonIndicator": true,
      "https://onerecord.iata.org/ns/cargo#dimensions": {
        "@type": ["https://onerecord.iata.org/ns/cargo#Dimensions"],
        "https://onerecord.iata.org/ns/cargo#width": {
          "@type": ["https://onerecord.iata.org/ns/cargo#Value"],
          "https://onerecord.iata.org/ns/cargo#numericalValue": "83",
        },
        "https://onerecord.iata.org/ns/cargo#height": {
          "@type": ["https://onerecord.iata.org/ns/cargo#Value"],
          "https://onerecord.iata.org/ns/cargo#numericalValue": "111",
        },
        "https://onerecord.iata.org/ns/cargo#length": {
          "@type": ["https://onerecord.iata.org/ns/cargo#Value"],
          "https://onerecord.iata.org/ns/cargo#numericalValue": "103",
        },
      },
    },
  ],
  "https://onerecord.iata.org/ns/cargo#waybill": {
    "@type": ["https://onerecord.iata.org/ns/cargo#Waybill"],
    "https://onerecord.iata.org/ns/cargo#departureLocation": {
      "@type": ["https://onerecord.iata.org/ns/cargo#Location"],
      "https://onerecord.iata.org/ns/cargo#locationCodes": [
        {
          "@id": "https://onerecord.champ.aero/ns/code-lists/iata-three-letter-codes#LUX",
        },
      ],
    },
    "https://onerecord.iata.org/ns/cargo#carrierDeclarationPlace": {
      "@type": ["https://onerecord.iata.org/ns/cargo#Location"],
      "https://onerecord.iata.org/ns/cargo#locationName": "Luxembourg",
    },
    "https://onerecord.iata.org/ns/cargo#accountingNotes": [
      {
        "@type": ["https://onerecord.iata.org/ns/cargo#AccountingNote"],
        "https://onerecord.iata.org/ns/cargo#accountingNoteIdentifier": "GeneralInformation",
        "https://onerecord.iata.org/ns/cargo#accountingNoteText": "DEB TFC",
      },
    ],
  },
};
