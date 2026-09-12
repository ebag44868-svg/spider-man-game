뉴욕 소품 에셋 파이프라인

원본(Fab 등에서 받은 zip/fbx/glb)은 저장소 밖 C:\spider_assets_raw\ 에 둔다.
도구는 C:\spider_assets_raw\_tools\ 에 따로 설치했다 (게임 폴더를 OneDrive 에서 무겁게 하지 않으려고).
  npm i @gltf-transform/cli@4 @gltf-transform/core@4 @gltf-transform/functions@4
        @gltf-transform/extensions@4 meshoptimizer sharp fbx2gltf gl-matrix

  node inspect.mjs    원본 전부를 GLB 로 모으고 삼각형·텍스처·뼈대·크기를 표로
  node optimize.mjs   고른 것만 실제 크기로 맞추고 폴리곤·텍스처를 줄여 assets/models/nyc/ 로

결과물 assets/models/nyc/ 는 .gitignore 되어 있다 — 라이선스 확인 전이라 공개 저장소에 올리지 않는다.
파일이 없으면 게임은 조용히 원래 코드 도시로 돈다 (src/nyc-props.js).
