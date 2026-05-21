[plugin:vite:esbuild] Transform failed with 1 error:
C:/Users/Lucas Guimarães/Desktop/cpg-labs/omnify/app/routes/app._index.tsx:282:7: ERROR: Multiple exports with the same name "default"
C:/Users/Lucas Guimarães/Desktop/cpg-labs/omnify/app/routes/app._index.tsx:282:7
Multiple exports with the same name "default"
280|  };
281|  
282|  export default function Index() {
   |         ^
283|    const {
284|      orders,
    at failureErrorWithLog (C:\Users\Lucas Guimarães\Desktop\cpg-labs\omnify\node_modules\esbuild\lib\main.js:1467:15)
    at C:\Users\Lucas Guimarães\Desktop\cpg-labs\omnify\node_modules\esbuild\lib\main.js:736:50
    at responseCallbacks.<computed> (C:\Users\Lucas Guimarães\Desktop\cpg-labs\omnify\node_modules\esbuild\lib\main.js:603:9)
    at handleIncomingPacket (C:\Users\Lucas Guimarães\Desktop\cpg-labs\omnify\node_modules\esbuild\lib\main.js:658:12)
    at Socket.readFromStdout (C:\Users\Lucas Guimarães\Desktop\cpg-labs\omnify\node_modules\esbuild\lib\main.js:581:7)
    at Socket.emit (node:events:508:28)
    at addChunk (node:internal/streams/readable:559:12)
    at readableAddChunkPushByteMode (node:internal/streams/readable:510:3)
    at Socket.Readable.push (node:internal/streams/readable:390:5)
    at Pipe.onStreamRead (node:internal/stream_base_commons:189:23
Click outside, press Esc key, or fix the code to dismiss.
You can also disable this overlay by setting server.hmr.overlay to false in vite.config.ts.