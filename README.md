# snippets

실무에서 직접 작성한 코드 중 일부를 모아둔 저장소입니다. 출시하고 운영했던 두 개의
React Native 앱에서 가져왔고, 토큰 값이나 내부 로그처럼 보안에 관련된 부분은 빼고
올렸습니다.

`@/...` 로 시작하는 import는 실제 앱 내부 모듈이라 그대로 실행되진 않지만, 로직과
구조를 읽기에는 충분합니다.

| 파일 | 내용 | 출처 |
| --- | --- | --- |
| `streamingFetch.ts` | 스트리밍 HTTP 응답 처리 | Shotup AI |
| `useSharedImage.ts` | iOS 공유 시트 이미지 수신 | Shotup AI |
| `DraggableAsset.tsx` | 멀티 제스처 + 좌표 변환 | Aug |
| `mapbox.ts` | 리버스 지오코딩, 거리/타일 계산 | Aug |
| `s3-presigned.ts` | Presigned URL 기반 S3 업로드 | Aug |

## Shotup AI

AI 기반 사진 정리 앱. (React Native 0.77, TypeScript)

### streamingFetch.ts

LLM 응답처럼 스트리밍으로 내려오는 HTTP 본문을 RN에서 받는 헬퍼입니다. RN은
`textStreaming` 플래그와 수동 reader 루프가 필요해서 좀 번거로운데, 이걸
`.onRead()` / `.onDone()` 같은 작은 이벤트 API로 감쌌습니다.

처음엔 청크 단위로 그냥 디코딩했다가 한글이 깨지는 걸 보고, `TextDecoder`의 stream
옵션과 줄 단위 버퍼링을 넣었습니다. 청크가 글자나 줄 중간에서 잘려도 완성된 줄만
넘어갑니다. 화면을 벗어나면 `cancel()`로 중단할 수 있습니다.

### useSharedImage.ts

iOS 공유 시트에서 App Group으로 넘어온 이미지를 받아오는 훅입니다. 앱이 포그라운드로
돌아오거나 URL 스킴으로 열릴 때 공유 데이터를 읽고, 한 번 처리한 뒤에는 슬롯을 비워서
같은 이미지가 두 번 처리되지 않게 했습니다.

## Aug

지도 기반 AR 소셜 앱. (React Native 0.79, React 19, TypeScript, Reanimated 3)

### DraggableAsset.tsx

AR에 올릴 에셋들을 드래그, 핀치, 탭으로 조작하는 컴포넌트입니다. 세 제스처를
충돌 없이 조합하고, 드래그가 끝나면 화면 픽셀 좌표를 실세계 미터 단위로 환산해서
넘깁니다. 좌표 변환은 Reanimated로 UI 스레드에서 처리합니다.

### mapbox.ts

지도에서 쓰는 순수 함수들입니다. 뷰포트를 덮는 타일 quadkey를 모으는
`tilesInBounds`(줌아웃 때 요청이 폭발하지 않게 상한을 둠), Haversine 거리 계산, 그리고
좌표를 동네/도시/지역 단위로 풀어주는 리버스 지오코딩이 들어 있습니다.

### s3-presigned.ts

백엔드에서 받은 presigned POST policy로 파일을 S3에 바로 올리는 코드입니다.
클라이언트가 AWS 자격증명을 직접 들고 있지 않아도 됩니다.
