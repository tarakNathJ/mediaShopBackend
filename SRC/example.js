// Node.js Backend (Server)
// This code sets up a simple WebSocket server for signaling
// and integrates mediasoup for WebRTC media handling.

import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import mediasoup from 'mediasoup';


const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from the React app build directory




// mediasoup variables
let worker;
let router;
let producerTransport;
let consumerTransport;
let producer;
let consumer;

// mediasoup configuration
const mediasoupConfig = {
  // Worker settings
  worker: {
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
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
  },
  // Router settings
  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000,
        },
      },
    ],
  },
  // WebRtcTransport settings
  webRtcTransport: {
    listenIps: [
      {
        ip: '127.0.0.1', // Replace with your server's IP in production
        announcedIp: null,
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1000000, // 1 Mbps
  },
};

// Function to create mediasoup worker and router
async function createWorkerAndRouter() {
  worker = await mediasoup.createWorker({
    rtcMinPort: mediasoupConfig.worker.rtcMinPort,
    rtcMaxPort: mediasoupConfig.worker.rtcMaxPort,
  });

  worker.on('died', () => {
    console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
    setTimeout(() => process.exit(1), 2000);
  });

  const routerOptions = {
    mediaCodecs: mediasoupConfig.router.mediaCodecs,
  };

  router = await worker.createRouter(routerOptions);

  console.log('mediasoup worker and router created');
}

// Call the function to create worker and router on startup
createWorkerAndRouter();

// WebSocket server logic
wss.on('connection', (ws) => {
  console.log('Client connected');

  // Handle messages from the client
  ws.on('message', async (message) => {
    const msg = JSON.parse(message);
    console.log('Received message:', msg.type);

    switch (msg.type) {
      case 'getRtpCapabilities':
        // Send the router's RTP capabilities to the client
        ws.send(JSON.stringify({
          type: 'rtpCapabilities',
          rtpCapabilities: router.rtpCapabilities,
        }));
        break;

      case 'createProducerTransport':
        try {
          // Create a WebRtcTransport for the producer
          producerTransport = await router.createWebRtcTransport(mediasoupConfig.webRtcTransport);

          producerTransport.on('dtlsstatechange', (dtlsState) => {
            if (dtlsState === 'closed') {
              console.log('Producer transport DTLS state changed to closed');
              producerTransport.close();
            }
          });

          producerTransport.on('close', () => {
            console.log('Producer transport closed');
          });

          // Send transport parameters back to the client
          ws.send(JSON.stringify({
            type: 'producerTransportCreated',
            id: producerTransport.id,
            iceParameters: producerTransport.iceParameters,
            iceCandidates: producerTransport.iceCandidates,
            dtlsParameters: producerTransport.dtlsParameters,
          }));
        } catch (error) {
          console.error('Error creating producer transport:', error);
          ws.send(JSON.stringify({ type: 'error', message: error.message }));
        }
        break;

      case 'connectProducerTransport':
        try {
          const { dtlsParameters } = msg;
          await producerTransport.connect({ dtlsParameters });
          console.log('Producer transport connected');
          ws.send(JSON.stringify({ type: 'producerTransportConnected' }));
        } catch (error) {
          console.error('Error connecting producer transport:', error);
          ws.send(JSON.stringify({ type: 'error', message: error.message }));
        }
        break;

      case 'produce':
        try {
          const { kind, rtpParameters } = msg;
          producer = await producerTransport.produce({ kind, rtpParameters });

          producer.on('transportclose', () => {
            console.log('Producer transport closed');
          });

          producer.on('close', () => {
            console.log('Producer closed');
          });

          console.log('Producer created');
          // Notify the client that the producer is created (and provide its ID if needed for consumption)
          ws.send(JSON.stringify({ type: 'producerCreated', id: producer.id }));

          // In a one-to-one call, when one client produces, the other needs to consume.
          // This simplified example assumes only two clients.
          // In a real app, you'd need logic to find the other client and trigger consumption.
          // For this example, let's assume the other client is also connected via WSS
          // and send a message to trigger their consumer creation.
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'newProducer', producerId: producer.id, kind: producer.kind }));
            }
          });

        } catch (error) {
          console.error('Error creating producer:', error);
          ws.send(JSON.stringify({ type: 'error', message: error.message }));
        }
        break;

      case 'createConsumerTransport':
        try {
          // Create a WebRtcTransport for the consumer
          consumerTransport = await router.createWebRtcTransport(mediasoupConfig.webRtcTransport);

          consumerTransport.on('dtlsstatechange', (dtlsState) => {
            if (dtlsState === 'closed') {
              console.log('Consumer transport DTLS state changed to closed');
              consumerTransport.close();
            }
          });

          consumerTransport.on('close', () => {
            console.log('Consumer transport closed');
          });

          // Send transport parameters back to the client
          ws.send(JSON.stringify({
            type: 'consumerTransportCreated',
            id: consumerTransport.id,
            iceParameters: consumerTransport.iceParameters,
            iceCandidates: consumerTransport.iceCandidates,
            dtlsParameters: consumerTransport.dtlsParameters,
          }));
        } catch (error) {
          console.error('Error creating consumer transport:', error);
          ws.send(JSON.stringify({ type: 'error', message: error.message }));
        }
        break;

      case 'connectConsumerTransport':
        try {
          const { dtlsParameters } = msg;
          await consumerTransport.connect({ dtlsParameters });
          console.log('Consumer transport connected');
          ws.send(JSON.stringify({ type: 'consumerTransportConnected' }));
        } catch (error) {
          console.error('Error connecting consumer transport:', error);
          ws.send(JSON.stringify({ type: 'error', message: error.message }));
        }
        break;

      case 'consume':
        try {
          const { rtpCapabilities, producerId } = msg;

          // Check if the router can consume the producer's media
          if (!router.canConsume({ producerId, rtpCapabilities })) {
            console.error('Router cannot consume producer', producerId);
            ws.send(JSON.stringify({ type: 'error', message: 'Cannot consume producer' }));
            return;
          }

          // Create a consumer
          consumer = await consumerTransport.consume({
            producerId,
            rtpCapabilities,
            paused: true, // Start paused
          });

          consumer.on('transportclose', () => {
            console.log('Consumer transport closed');
          });

          consumer.on('producerclose', () => {
            console.log('Producer closed, closing consumer');
            consumer.close();
          });

          console.log('Consumer created');
          // Send consumer parameters back to the client
          ws.send(JSON.stringify({
            type: 'consumerCreated',
            id: consumer.id,
            producerId: consumer.producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            // Add these for client-side consumption setup
            transportId: consumerTransport.id,
          }));
        } catch (error) {
          console.error('Error creating consumer:', error);
          ws.send(JSON.stringify({ type: 'error', message: error.message }));
        }
        break;

      case 'resumeConsumer':
        try {
          if (consumer) {
            await consumer.resume();
            console.log('Consumer resumed');
            ws.send(JSON.stringify({ type: 'consumerResumed' }));
          }
        } catch (error) {
          console.error('Error resuming consumer:', error);
          ws.send(JSON.stringify({ type: 'error', message: error.message }));
        }
        break;

      default:
        console.warn('Unknown message type:', msg.type);
        break;
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    // Clean up mediasoup resources associated with this client
    // In a real application, you'd manage transports/producers/consumers per client
    if (producerTransport) {
        producerTransport.close();
        producerTransport = null;
    }
    if (consumerTransport) {
        consumerTransport.close();
        consumerTransport = null;
    }
    if (producer) {
        producer.close();
        producer = null;
    }
    if (consumer) {
        consumer.close();
        consumer = null;
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
