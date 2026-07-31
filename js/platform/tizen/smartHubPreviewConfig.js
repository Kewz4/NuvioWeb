export const SMART_HUB_PREVIEW_CONFIG = Object.freeze({
  addonId: "app.xperience.f6ca2edb-6f76-459f-b7dc-3510c2aeae86",
  addonName: "Xperience",
  manifestUrl:
    "https://xperience-app.com/manifest/f6ca2edb-6f76-459f-b7dc-3510c2aeae86/eyJhbGciOiJIUzI1NiJ9.eyJwaWQiOiJmNmNhMmVkYi02Zjc2LTQ1OWYtYjdkYy0zNTEwYzJhZWFlODYiLCJraWQiOiJkZWE0YWJmMy1hMTc5LTQ0YWEtOTgxZC1mOGU0ZjY5NmU4MzkiLCJzY29wZSI6Im1hbmlmZXN0Iiwic3ViIjoiZTk3MjM3ZmMtZWMyYy00Y2NkLTg5OWQtYmY1MDI3M2YzNTIyIiwiaWF0IjoxNzg1NDc1MDY2fQ.OkqytFVzR1e9VLL82PoYzlaXzeLVXW1FspNQTwNogik/manifest.json",
  continueWatchingLimit: 3,
  refreshDebounceMs: 15000,
  catalogSections: Object.freeze([
    Object.freeze({
      key: "because-movies",
      title: "Porque viste · Películas",
      type: "movie",
      catalogId: "recs_because_movies",
      limit: 2
    }),
    Object.freeze({
      key: "because-series",
      title: "Porque viste · Series",
      type: "series",
      catalogId: "recs_because_series",
      limit: 2
    }),
    Object.freeze({
      key: "top100-movies",
      title: "Top 100 hoy · Películas",
      type: "movie",
      catalogId: "snoak_top100_movies",
      limit: 2
    }),
    Object.freeze({
      key: "top100-series",
      title: "Top 100 hoy · Series",
      type: "series",
      catalogId: "snoak_top100_series",
      limit: 2
    })
  ]),
  folderSections: Object.freeze([
    Object.freeze({
      key: "studios",
      title: "Studios",
      collectionId: "b9a327ea-1e13-47d7-a623-0324f08dac6b",
      shortcuts: Object.freeze([
        Object.freeze({
          title: "Marvel",
          folderId: "52e31de1-783d-4e6e-b388-8b67c30465ba",
          imageUrl:
            "https://raw.githubusercontent.com/Kewz4/NuvioWeb/main/assets/smart-hub-preview/studios-marvel.jpg",
          fallbackType: "movie",
          fallbackCatalogId: "studio_marvel_movies"
        }),
        Object.freeze({
          title: "DC",
          folderId: "c12a28cf-088b-4ee0-a0fb-2172aab7bcb9",
          imageUrl:
            "https://raw.githubusercontent.com/Kewz4/NuvioWeb/main/assets/smart-hub-preview/studios-dc.jpg",
          fallbackType: "movie",
          fallbackCatalogId: "studio_dc_movies"
        }),
        Object.freeze({
          title: "A24",
          folderId: "2e1f0106-9dc5-459c-997c-ac06c63ee0a5",
          imageUrl:
            "https://raw.githubusercontent.com/Kewz4/NuvioWeb/main/assets/smart-hub-preview/studios-a24.jpg",
          fallbackType: "movie",
          fallbackCatalogId: "studio_a24_movies"
        }),
        Object.freeze({
          title: "Pixar",
          folderId: "317ca8c6-760d-416f-a531-dd6723140ec8",
          imageUrl:
            "https://raw.githubusercontent.com/Kewz4/NuvioWeb/main/assets/smart-hub-preview/studios-pixar.jpg",
          fallbackType: "movie",
          fallbackCatalogId: "studio_pixar_movies"
        }),
        Object.freeze({
          title: "Disney Animated",
          folderId: "ee9e0c5a-4934-4945-8497-d128f6466a7a",
          imageUrl:
            "https://raw.githubusercontent.com/Kewz4/NuvioWeb/main/assets/smart-hub-preview/studios-disney-animated.jpg",
          fallbackType: "movie",
          fallbackCatalogId: "studio_disney_animated_movies"
        })
      ])
    }),
    Object.freeze({
      key: "streaming",
      title: "Streaming",
      collectionId: "5bcee819-c48e-4d74-b740-f43c24281a87",
      shortcuts: Object.freeze([
        Object.freeze({
          title: "Netflix",
          folderId: "ec4fd26a-ecee-48f1-9be2-a8d5f5eb2821",
          imageUrl:
            "https://raw.githubusercontent.com/Kewz4/NuvioWeb/main/assets/smart-hub-preview/streaming-netflix.jpg",
          fallbackType: "movie",
          fallbackCatalogId: "streaming_netflix_movies"
        }),
        Object.freeze({
          title: "Prime Video",
          folderId: "9063a10b-a55e-4ec2-a5a4-79f7c1f28370",
          imageUrl:
            "https://raw.githubusercontent.com/Kewz4/NuvioWeb/main/assets/smart-hub-preview/streaming-prime-video.jpg",
          fallbackType: "movie",
          fallbackCatalogId: "streaming_prime_movies"
        }),
        Object.freeze({
          title: "Disney+",
          folderId: "ec4b312c-9a16-417c-8bc0-fa62ce8c85f2",
          imageUrl:
            "https://raw.githubusercontent.com/Kewz4/NuvioWeb/main/assets/smart-hub-preview/streaming-disney-plus.jpg",
          fallbackType: "movie",
          fallbackCatalogId: "streaming_disney_movies"
        }),
        Object.freeze({
          title: "HBO Max",
          folderId: "994d778e-226c-48a7-8413-ee835ad874d8",
          imageUrl:
            "https://raw.githubusercontent.com/Kewz4/NuvioWeb/main/assets/smart-hub-preview/streaming-hbo-max.jpg",
          fallbackType: "movie",
          fallbackCatalogId: "streaming_hbo_movies"
        }),
        Object.freeze({
          title: "Apple TV+",
          folderId: "ec45b0d2-f80f-4c30-bdb0-d33724744c0c",
          imageUrl:
            "https://raw.githubusercontent.com/Kewz4/NuvioWeb/main/assets/smart-hub-preview/streaming-apple-tv-plus.jpg",
          fallbackType: "movie",
          fallbackCatalogId: "streaming_apple_movies"
        })
      ])
    })
  ])
});
