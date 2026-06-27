import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { authService } from '../services/auth.service';

interface Detection {
  box: [number, number, number, number];
  class: string;
  confidence: number;
  prediction?: string;
  timestamp: string;
}


const VideoPrediction: React.FC = () => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [frameCount, setFrameCount] = useState(0);
  const [fps, setFps] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [error, setError] = useState<string | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  // Per-fruit debounce: only alert+save once per 60s per fruit
  const alertedFruitsRef = useRef<Map<string, number>>(new Map());

  const startStream = useCallback(async () => {
    try {
      setError(null);
      setConnectionStatus('connecting');
      
      // Get camera stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'environment'
        }
      });
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      
      // Connect to WebSocket
      const ws = new WebSocket('ws://localhost:8000/ws/video');
      websocketRef.current = ws;
      
      ws.onopen = () => {
         console.log("WebSocket opened");
        setConnectionStatus('connected');
        setIsStreaming(true);
        startFrameCapture();
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'detection_results') {
            setDetections(data.detections);
            setFrameCount(data.frame_count);
            setError(null);

            // Find rotten detections not alerted in past 60s
            const now = Date.now();
            const newRotten: typeof data.detections = data.detections.filter((d: any) => {
              if (d.prediction !== 'rotten') return false;
              const last = alertedFruitsRef.current.get(d.class) ?? 0;
              return now - last > 60000;
            });

            if (newRotten.length > 0) {
              // Mark alerted
              newRotten.forEach((d: any) => alertedFruitsRef.current.set(d.class, now));

              // Save each rotten detection to DB
              newRotten.forEach((d: any) => {
                axios.post('http://localhost:3000/api/products/from-detection', {
                  fruit: d.class,
                  prediction: 'rotten_' + d.class,
                  spoilage_score: d.spoilage_score ?? 0.95,
                  sensor_data: {
                    estimated_days_left: 0,
                    ethylene_ppm: 8.5,
                    temperature_c: 27,
                    humidity_percent: 75,
                  },
                  pricing: {
                    action: 'donate',
                    discount_applied: true,
                    discount_percent: 70,
                    price_usd: 0.30,
                    message: 'Webcam live detection — rotten',
                  },
                }).catch(() => {});
              });

              // Trigger dashboard refresh
              window.dispatchEvent(new CustomEvent('detection-saved'));

              // Send WhatsApp alert
              const user = authService.getCurrentUser();
              const phone = user?.phone;
              if (phone) {
                axios.post('http://localhost:3000/api/alerts/spoilage', {
                  phone,
                  detections: newRotten.map((d: any) => ({
                    fruit: d.class,
                    prediction: 'rotten_' + d.class,
                    spoilage_score: d.spoilage_score ?? 0.95,
                    confidence: d.confidence,
                  })),
                }).then(res => {
                  if (res.data.whatsappSent) {
                    toast.error(`🚨 Rotten ${newRotten.map((d: any) => d.class).join(', ')} detected — WhatsApp alert sent!`, { duration: 5000 });
                  } else {
                    toast.error(`🚨 Rotten ${newRotten.map((d: any) => d.class).join(', ')} detected — rescue request created`, { duration: 5000 });
                  }
                }).catch(() => {
                  toast.error(`🚨 Rotten ${newRotten.map((d: any) => d.class).join(', ')} detected!`, { duration: 5000 });
                });
              } else {
                toast.error(`🚨 Rotten ${newRotten.map((d: any) => d.class).join(', ')} detected!`, { duration: 5000 });
              }
            }
          } else if (data.type === 'error') {
            console.error('Server error:', data.message);
            setError(`Server error: ${data.message}`);
          }
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
          setError('Error parsing server response');
        }
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError('WebSocket connection failed');
        setConnectionStatus('disconnected');
      };
      
      ws.onclose = () => {
        setConnectionStatus('disconnected');
        setIsStreaming(false);
      };
      
    } catch (err) {
      console.error('Error starting stream:', err);
      setError('Failed to access camera or start stream');
      setConnectionStatus('disconnected');
    }
  }, []);

  const stopStream = useCallback(() => {
    setIsStreaming(false);
    setDetections([]);
    setFrameCount(0);
    setFps(0);
    
    // Stop animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Close WebSocket
    if (websocketRef.current) {
      websocketRef.current.close();
      websocketRef.current = null;
    }
    
    // Stop camera stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    setConnectionStatus('disconnected');
  }, []);

  const startFrameCapture = useCallback(() => {
    const captureFrame = () => {
      console.log("CaptureFrame called"); 

      if (!videoRef.current) {
        console.log("No videoRef");
        return;
      }
      if (!canvasRef.current) {
        console.log("No canvasRef");
        return;
      }
      if (!websocketRef.current) {
        console.log("No websocketRef");
        return;
      }

      
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) return;

      if (video.videoWidth === 0 || video.videoHeight === 0) {
        animationFrameRef.current = requestAnimationFrame(captureFrame);
        return;
      }
      
      // Set canvas size to match video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      // Draw video frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      detections.forEach(detection => {
        const [x1, y1, x2, y2] = detection.box;
        const confidence = detection.confidence;
        const prediction = detection.prediction || 'unknown';

        let color = '#00ff00'; // fresh = green
        if (prediction === 'rotten') color = '#ff0000';
        else if (prediction === 'unknown') color = '#ffff00';

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        const label = `${detection.class} (${(confidence * 100).toFixed(1)}%) - ${prediction}`;
        const labelWidth = ctx.measureText(label).width + 10;
        const labelHeight = 20;

        ctx.fillStyle = color;
        ctx.fillRect(x1, y1 - labelHeight, labelWidth, labelHeight);

        ctx.fillStyle = '#000000';
        ctx.font = '12px Arial';
        ctx.fillText(label, x1 + 5, y1 - 5);
    });
        
        // Convert to base64
        const frameData = canvas.toDataURL('image/jpeg', 0.8);
        const base64Data = frameData.split(',')[1];
        console.log("Base64 length:", base64Data.length);
      
      // Send frame to server
      const message = {
        type: 'frame',
        frame: base64Data,
        frame_count: frameCountRef.current
      };
      
      if (websocketRef.current?.readyState === WebSocket.OPEN) {
        console.log("Sending frame message:", message); 
        websocketRef.current.send(JSON.stringify(message));
        frameCountRef.current++;
        
        // Log every 30 frames for debugging
        if (frameCountRef.current % 30 === 0) {
          console.log(`Sent frame ${frameCountRef.current}, frame size: ${base64Data.length} chars`);
        }
      } else {
        console.warn('WebSocket not open, frame not sent');
      }
      
      // Calculate FPS
      const now = performance.now();
      if (lastFrameTimeRef.current > 0) {
        const deltaTime = now - lastFrameTimeRef.current;
        setFps(Math.round(1000 / deltaTime));
      }
      lastFrameTimeRef.current = now;
      
      // Continue capturing
      animationFrameRef.current = requestAnimationFrame(captureFrame);
    };
    
    captureFrame();
  }, [isStreaming]);

  // const drawDetections = useCallback(() => {
  //   if (!canvasRef.current || !videoRef.current) return;
    
  //   const canvas = canvasRef.current;
  //   const ctx = canvas.getContext('2d');
  //   if (!ctx) return;
    
  //   // Clear previous drawings
  //   ctx.clearRect(0, 0, canvas.width, canvas.height);
    
  //   // Draw video frame
  //   ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    
  //   // Draw detection boxes
  //   detections.forEach(detection => {
  //     const [x1, y1, x2, y2] = detection.box;
  //     const confidence = detection.confidence;
  //     const prediction = detection.prediction || 'unknown';
      
  //     // Choose color based on prediction
  //     let color = '#00ff00'; // green for fresh
  //     if (prediction === 'rotten') {
  //       color = '#ff0000'; // red for rotten
  //     } else if (prediction === 'unknown') {
  //       color = '#ffff00'; // yellow for unknown
  //     }
      
  //     // Draw bounding box
  //     ctx.strokeStyle = color;
  //     ctx.lineWidth = 2;
  //     ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      
  //     // Draw label background
  //     const label = `${detection.class} (${(confidence * 100).toFixed(1)}%) - ${prediction}`;
  //     const labelWidth = ctx.measureText(label).width + 10;
  //     const labelHeight = 20;
      
  //     ctx.fillStyle = color;
  //     ctx.fillRect(x1, y1 - labelHeight, labelWidth, labelHeight);
      
  //     // Draw label text
  //     ctx.fillStyle = '#000000';
  //     ctx.font = '12px Arial';
  //     ctx.fillText(label, x1 + 5, y1 - 5);
  //   });
  // }, [detections]);

  // Draw detections when they change
  // useEffect(() => {
  //   drawDetections();
  // }, [detections, drawDetections]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStream();
    };
  }, [stopStream]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold text-gray-900">Real-time YOLO Video Prediction</h2>
          <div className="flex items-center space-x-4">
            <div className={`px-3 py-1 rounded-full text-sm font-medium ${
              connectionStatus === 'connected' ? 'bg-green-100 text-green-800' :
              connectionStatus === 'connecting' ? 'bg-yellow-100 text-yellow-800' :
              'bg-red-100 text-red-800'
            }`}>
              {connectionStatus === 'connected' ? 'Connected' :
               connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
            </div>
            {fps > 0 && (
              <div className="text-sm text-gray-600">
                FPS: {fps}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Video Stream */}
          <div className="lg:col-span-2">
            <div className="relative bg-black rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                className="w-full h-auto"
                autoPlay
                playsInline
                muted
              />
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full pointer-events-none"
              />
              {!isStreaming && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75">
                  <div className="text-center text-white">
                    <p className="text-lg font-medium mb-2">Camera Preview</p>
                    <p className="text-sm">Click "Start Stream" to begin real-time prediction</p>
                  </div>
                </div>
              )}
            </div>
            
            <div className="mt-4 flex justify-center space-x-4">
              {!isStreaming ? (
                <button
                  onClick={startStream}
                  disabled={connectionStatus === 'connecting'}
                  className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {connectionStatus === 'connecting' ? 'Starting...' : 'Start Stream'}
                </button>
              ) : (
                <button
                  onClick={stopStream}
                  className="px-6 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                >
                  Stop Stream
                </button>
              )}
            </div>
          </div>

          {/* Detection Results */}
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-lg font-medium text-gray-900 mb-3">Detection Stats</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Frame Count:</span>
                  <span className="font-medium">{frameCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Objects Detected:</span>
                  <span className="font-medium">{detections.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Fresh Objects:</span>
                  <span className="font-medium text-green-600">
                    {detections.filter(d => d.prediction === 'fresh').length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Rotten Objects:</span>
                  <span className="font-medium text-red-600">
                    {detections.filter(d => d.prediction === 'rotten').length}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-lg font-medium text-gray-900 mb-3">Recent Detections</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {detections.length === 0 ? (
                  <p className="text-gray-500 text-sm">No objects detected yet</p>
                ) : (
                  detections.slice(-10).reverse().map((detection, index) => (
                    <div key={index} className="bg-white rounded p-2 border-l-4 border-gray-300">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-sm">{detection.class}</p>
                          <p className="text-xs text-gray-600">
                            Confidence: {(detection.confidence * 100).toFixed(1)}%
                          </p>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          detection.prediction === 'fresh' ? 'bg-green-100 text-green-800' :
                          detection.prediction === 'rotten' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {detection.prediction || 'unknown'}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <h3 className="text-lg font-medium text-blue-900 mb-2">How it works</h3>
          <p className="text-blue-800 text-sm mb-2">
            Real-time YOLO + CNN detection: frames are sent to the AI server, which detects food items and classifies them as fresh or rotten with bounding boxes.
          </p>
          <p className="text-blue-700 text-xs font-medium">
            Detectable items: 🍎 Apple &bull; 🍌 Banana &bull; 🍊 Orange &bull; 🥦 Broccoli &bull; 🥕 Carrot &bull; 🥪 Sandwich &bull; 🌭 Hot Dog &bull; 🍕 Pizza &bull; 🍩 Donut &bull; 🎂 Cake
          </p>
        </div>
      </div>
    </div>
  );
};

export default VideoPrediction; 
