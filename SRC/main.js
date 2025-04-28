import express from 'express';
import { WebSocketServer } from 'ws';
import mediasoup from 'mediasoup'
import e from 'express';

const app = express();
const port = 3000;


const Server = app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
}
);

let SenderTransport = null;
let ReseverTransport = null;
let Worker = null;
let Router = null;
let Producer = null;
let Consumer = null;


const createWorker = async () => {
  const Worker = await mediasoup.createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
    logLevel: 'warn',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp',
      'rtx',
      'bwe',
      'score',
      'simulcast',
      'svc',
      'sctp',
    ],
  });
  console.log(`Worker pid : ${Worker.pid}`);
  Worker.on('died', () => {
    console.error('Worker died , exiting process');
    setTimeout(() => process.exit(1), 2000);
  })

  return Worker;
}

Worker = await createWorker();

const MediaCodec = [
  {
    "mimeType": "audio/opus",
    "kind": "audio",
    "clockRate": 48000,
    "channels": 2,
    "rtcpFeedback": [
      { "type": "transport-cc" }
    ],
    "parameters": {
      "useinbandfec": 1,
      "usedtx": 1
    }
  },
  {
    "mimeType": "video/VP8",
    "kind": "video",
    "clockRate": 90000,
    "rtcpFeedback": [
      { "type": "nack" },
      { "type": "nack", "parameter": "pli" },
      { "type": "ccm", "parameter": "fir" },
      { "type": "goog-remb" },
      { "type": "transport-cc" }
    ],
    "parameters": {}
  },
  {
    "mimeType": "video/H264",
    "kind": "video",
    "clockRate": 90000,
    "rtcpFeedback": [
      { "type": "nack" },
      { "type": "nack", "parameter": "pli" },
      { "type": "ccm", "parameter": "fir" },
      { "type": "goog-remb" },
      { "type": "transport-cc" }
    ],
    "parameters": {
      "packetization-mode": 1,
      "profile-level-id": "42e01f",
      "level-asymmetry-allowed": 1
    }
  },
  {
    "mimeType": "video/H264",
    "kind": "video",
    "clockRate": 90000,
    "rtcpFeedback": [
      { "type": "nack" },
      { "type": "nack", "parameter": "pli" },
      { "type": "ccm", "parameter": "fir" },
      { "type": "goog-remb" },
      { "type": "transport-cc" }
    ],
    "parameters": {
      "packetization-mode": 1,
      "profile-level-id": "42a01f",
      "level-asymmetry-allowed": 1
    }
  }
  // ... potentially other codecs like VP9, AV1, etc.
]

const Wss = new WebSocketServer({ server: Server });

Wss.on('connection', async (ws) => {

  const send = (event, data) => {
    // console.log("this is ws id",ws);
    ws.send(JSON.stringify({ type: event, data }));
  };

  ws.on('message', async (message) => {

    const data = JSON.parse(message);
    if (data.type === "join_user") {
      console.log("join user")
    }
    if (data.type === 'getRouterRtpCapabilities') {
      const routerRtpCapabilities = Router.rtpCapabilities;
      ws.send(JSON.stringify({ type: 'routerRtpCapabilities', routerRtpCapabilities }));
    }


    if (data.type === 'createWebRtcTransport') {
      const { sender } = data;

      if (!Router) {
        console.error('Router not initialized.');
        ws.send(JSON.stringify({ type: 'transport-error', error: 'Router not initialized' }));
        return;
      }
      const transport = await createWebRtcTransport(send);
      if (sender) {
        SenderTransport = transport;
      } else {
        ReseverTransport = transport;
      }

    }


    if (data.type === 'transport_connect') {
      console.log("DTLS params ... : sender")
      const { dtlsParameters } = data;

      if (!SenderTransport) {
        console.error('Sender transport not initialized.');
        send('transport-error', { error: 'Sender transport not initialized' });
        return;
      }
      await SenderTransport.connect({ dtlsParameters });
      // console.log('DTLS params ... : ', { dtlsParameters });
      // if (SenderTransport) {
      //   await SenderTransport.connect({ dtlsParameters });
      //   console.log("DTLS params ... : sender")
      // } else {
      //   await ReseverTransport.connect({ dtlsParameters })
      // }
      ws.send(JSON.stringify({ type: 'transport_connected' }));
      console.log('Sender transport connected');
    }

    if (data.type === 'transport_produce') {
      
      try {
        const { kind, rtpParameters } = data;
        if (!SenderTransport) {
          console.error('Sender transport not initialized.');
          send('transport-error', { error: 'Sender transport not initialized' });
          return;
        }
        Producer = await SenderTransport.produce({ kind, rtpParameters });
        console.log('Producer created');
        ws.send(JSON.stringify({ type: 'producer_created', id: Producer.id }));
      }
      catch (error) {
        console.error('Error producing:', error);
        send('transport-error', { error: 'Error producing' });
      }
    }

    

  });
  ws.on('close', () => {
    console.log('Client disconnected');
  });

  Router = await Worker.createRouter({ mediaCodecs: MediaCodec });

})


const createWebRtcTransport = async (send) => {
  try {
    const WebRtcTransport_Option = {
      listenIps: [{
        ip: '0.0.0.0', // replace with relevant IP address
        announcedIp: null,
      }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1000000,
      maxIncomingBitrate: 1500000,
    }

    const transport = await Router.createWebRtcTransport(WebRtcTransport_Option);
    transport.on('dtlsstatechange', dtlsState => {
      if (dtlsState === 'closed') {
        transport.close();
      }
    });
    transport.on('close', () => {
      console.log('Transport closed');
    });
    send('transport_created', {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    });
    return transport;

  } catch (error) {
    console.error('Error creating WebRTC transport:', error);
    send('transport-error', { error: 'Error creating WebRTC transport' });
  }

}
