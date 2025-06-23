import React, { useState, useEffect, useRef } from 'react';
import * as Pitchfinder from 'pitchfinder';
import './App.css';
import packageJson from '../package.json';

const GuitarTuner = () => {
  const [isListening, setIsListening] = useState(false);
  const [frequency, setFrequency] = useState(0);
  const [note, setNote] = useState('');
  const [cents, setCents] = useState(0);
  const [volume, setVolume] = useState(0);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [selectedTuning, setSelectedTuning] = useState('standard');
  const [browserSupport, setBrowserSupport] = useState({ supported: true, message: '' });

  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const detectPitchRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Standard guitar tuning frequencies (Hz)
  const standardTuning = {
    standard: [
      { note: 'E', freq: 82.41, string: 6 },   // Low E
      { note: 'A', freq: 110.00, string: 5 },  // A
      { note: 'D', freq: 146.83, string: 4 },  // D
      { note: 'G', freq: 196.00, string: 3 },  // G
      { note: 'B', freq: 246.94, string: 2 },  // B
      { note: 'E', freq: 329.63, string: 1 }   // High E
    ],
    dropD: [
      { note: 'D', freq: 73.42, string: 6 },   // Drop D
      { note: 'A', freq: 110.00, string: 5 },  // A
      { note: 'D', freq: 146.83, string: 4 },  // D
      { note: 'G', freq: 196.00, string: 3 },  // G
      { note: 'B', freq: 246.94, string: 2 },  // B
      { note: 'E', freq: 329.63, string: 1 }   // High E
    ]
  };

  // Convert frequency to note name and cents deviation
  const frequencyToNote = (freq) => {
    const A4 = 440;
    const C0 = A4 * Math.pow(2, -4.75);
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    
    if (freq > 0) {
      const h = Math.round(12 * Math.log2(freq / C0));
      const octave = Math.floor(h / 12);
      const n = h % 12;
      const noteFreq = C0 * Math.pow(2, h / 12);
      const cents = Math.floor(1200 * Math.log2(freq / noteFreq));
      
      return {
        note: noteNames[n],
        octave: octave,
        cents: cents,
        frequency: freq
      };
    }
    return { note: '', octave: 0, cents: 0, frequency: 0 };
  };

  // Get tuning accuracy (how close to target note)
  const getTuningAccuracy = (currentFreq) => {
    const currentTuning = standardTuning[selectedTuning];
    let closestNote = null;
    let minDiff = Infinity;

    currentTuning.forEach(targetNote => {
      const diff = Math.abs(currentFreq - targetNote.freq);
      if (diff < minDiff) {
        minDiff = diff;
        closestNote = targetNote;
      }
    });

    if (closestNote) {
      const cents = 1200 * Math.log2(currentFreq / closestNote.freq);
      return {
        targetNote: closestNote.note,
        targetString: closestNote.string,
        cents: cents,
        inTune: Math.abs(cents) < 10 // Within 10 cents is considered in tune
      };
    }
    return null;
  };

  // Check browser support and requirements
  useEffect(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const isSecureContext = window.isSecureContext;
    
    console.log('Browser detection:', {
      isIOS,
      isSafari,
      isSecureContext,
      protocol: window.location.protocol
    });

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setBrowserSupport({
        supported: false,
        message: 'Your browser does not support audio input. Please try Chrome or Firefox.'
      });
    } else if (isIOS && !isSecureContext) {
      setBrowserSupport({
        supported: false,
        message: 'On iOS, this app requires HTTPS to access the microphone. Please use a secure connection.'
      });
    }
  }, []);

  // Initialize audio context and pitch detection
  const initializeAudio = async () => {
    try {
      console.log('Requesting microphone access...');
      
      // Create audio context first
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        console.log('Audio context created, state:', audioContextRef.current.state);
      }

      // For Safari, we need to handle permissions differently
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      
      if (isIOS && isSafari) {
        // On Safari iOS, we need to request permission explicitly
        const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
        console.log('Microphone permission status:', permissionStatus.state);
        
        if (permissionStatus.state === 'denied') {
          alert('Microphone access is blocked. Please go to Settings > Safari > [Your Website] and enable microphone access.');
          throw new Error('Microphone permission denied');
        }
      }
      
      // Ensure audio context is resumed
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
        console.log('Audio context resumed, new state:', audioContextRef.current.state);
      }
      
      // Request microphone permission with more permissive constraints
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true
        } 
      });
      
      console.log('Microphone access granted, stream:', stream);
      streamRef.current = stream;
      setPermissionGranted(true);

      const source = audioContextRef.current.createMediaStreamSource(stream);
      console.log('Media stream source created');
      
      // Create analyser with settings optimized for guitar
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 8192;
      analyserRef.current.smoothingTimeConstant = 0.3;
      analyserRef.current.minDecibels = -100;
      analyserRef.current.maxDecibels = -10;
      source.connect(analyserRef.current);
      console.log('Analyser connected, fftSize:', analyserRef.current.fftSize);

      // Initialize pitch detection algorithms
      detectPitchRef.current = {
        yin: Pitchfinder.YIN({
          sampleRate: audioContextRef.current.sampleRate,
          threshold: 0.15,
          probabilityThreshold: 0.1
        }),
        autocorrelation: Pitchfinder.AMDF({
          sampleRate: audioContextRef.current.sampleRate,
          minFrequency: 60,
          maxFrequency: 2000
        })
      };
      console.log('Pitch detection initialized with multiple algorithms');

      return true;
    } catch (error) {
      console.error('Error in initializeAudio:', error);
      
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      
      if (isIOS && isSafari && error.name === 'NotAllowedError') {
        alert('To enable microphone access on iOS Safari:\n\n1. Go to Settings > Safari\n2. Scroll down to the website settings\n3. Enable microphone access for this website\n4. Return to Safari and refresh the page');
      } else if (error.name === 'NotAllowedError') {
        alert('Please allow microphone access to use the tuner. If you denied permission, you may need to reset it in your browser settings.');
      } else if (error.name === 'NotFoundError') {
        alert('No microphone found. Please ensure your device has a working microphone.');
      } else if (error.name === 'NotReadableError') {
        alert('Could not access your microphone. Please try reloading the page.');
      } else {
        alert('Error accessing microphone: ' + error.message);
      }
      setPermissionGranted(false);
      return false;
    }
  };

  // Audio analysis loop
  const analyzeAudio = () => {
    try {
      if (!analyserRef.current || !detectPitchRef.current) {
        console.log('Missing analyser or pitch detector');
        return;
      }

      // Always log first few iterations to confirm loop is running
      if (!window.audioLoopCount) window.audioLoopCount = 0;
      window.audioLoopCount++;
      
      if (window.audioLoopCount <= 10 || window.audioLoopCount % 100 === 0) {
        console.log('Audio analysis loop running, iteration:', window.audioLoopCount, 'isListening:', isListening);
      }

      const bufferLength = analyserRef.current.fftSize;
      const dataArray = new Float32Array(bufferLength);
      analyserRef.current.getFloatTimeDomainData(dataArray);

      // Calculate volume (RMS) - much more sensitive calculation
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / bufferLength);
      const currentVolume = Math.max(0, Math.min(100, rms * 1000)); // Increased multiplier

      // Also try frequency domain for volume detection
      const freqData = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(freqData);
      
      // Calculate average frequency domain volume
      let freqSum = 0;
      for (let i = 0; i < freqData.length; i++) {
        freqSum += freqData[i];
      }
      const avgFreqVolume = freqSum / freqData.length;
      
      // Use the higher of the two volume measurements
      const finalVolume = Math.max(currentVolume, avgFreqVolume);
      setVolume(finalVolume);

      // Log volume more frequently for debugging
      if (window.audioLoopCount <= 10 || window.audioLoopCount % 30 === 0) {
        console.log('Volume levels - RMS:', currentVolume.toFixed(2), 'Freq:', avgFreqVolume.toFixed(2), 'Final:', finalVolume.toFixed(2));
      }

      // ALWAYS try pitch detection with multiple algorithms - WITH DETAILED DEBUGGING
      let pitch = null;
      let pitchSource = 'none';
      
      // Try YIN algorithm first (better for pure tones)
      if (detectPitchRef.current?.yin) {
        pitch = detectPitchRef.current.yin(dataArray);
        if (pitch) pitchSource = 'YIN';
      }
      
      // If YIN fails, try autocorrelation (better for complex tones like guitar)
      if (!pitch && detectPitchRef.current?.autocorrelation) {
        pitch = detectPitchRef.current.autocorrelation(dataArray);
        if (pitch) pitchSource = 'AMDF';
      }
      
      // Simple autocorrelation approach for guitar strings
      if (!pitch && finalVolume > 2) {
        // Simple autocorrelation implementation
        const sampleRate = audioContextRef.current.sampleRate;
        const minPeriod = Math.floor(sampleRate / 800); // Max 800 Hz
        const maxPeriod = Math.floor(sampleRate / 60);  // Min 60 Hz (low guitar range)
        
        let bestCorrelation = 0;
        let bestPeriod = 0;
        
        for (let period = minPeriod; period < Math.min(maxPeriod, dataArray.length / 2); period++) {
          let correlation = 0;
          for (let i = 0; i < dataArray.length - period; i++) {
            correlation += dataArray[i] * dataArray[i + period];
          }
          
          if (correlation > bestCorrelation) {
            bestCorrelation = correlation;
            bestPeriod = period;
          }
        }
        
        if (bestCorrelation > 0.01 && bestPeriod > 0) {
          pitch = sampleRate / bestPeriod;
          pitchSource = 'SimpleAutocorrelation';
        }
      }
      
      // FFT approach for very low frequencies (focusing on guitar range)
      if (!pitch && finalVolume > 1) {
        const freqData = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(freqData);
        
        // Find multiple peaks and try to identify the fundamental
        const peaks = [];
        for (let i = 2; i < freqData.length / 8; i++) { // Focus on lower frequencies
          if (freqData[i] > freqData[i-1] && freqData[i] > freqData[i+1] && freqData[i] > 80) {
            const freq = (i * audioContextRef.current.sampleRate) / analyserRef.current.fftSize;
            if (freq >= 60 && freq <= 800) { // Guitar fundamental range
              peaks.push({ freq, magnitude: freqData[i] });
            }
          }
        }
        
        // Sort peaks by magnitude
        peaks.sort((a, b) => b.magnitude - a.magnitude);
        
        if (peaks.length > 0) {
          // Try to find the fundamental frequency
          const candidate = peaks[0].freq;
          
          // Check if this could be a guitar string frequency
          const guitarFreqs = [82.41, 110.00, 146.83, 196.00, 246.94, 329.63]; // Standard tuning
          const tolerance = 50; // Hz tolerance
          
          const isNearGuitarFreq = guitarFreqs.some(gf => Math.abs(candidate - gf) < tolerance);
          
          if (isNearGuitarFreq || peaks[0].magnitude > 100) {
            pitch = candidate;
            pitchSource = 'FFT-Peak';
          }
        }
      }
      
      // Debug logging
      if (window.audioLoopCount <= 20 || (finalVolume > 2 && window.audioLoopCount % 10 === 0)) {
        console.log('🔍 Pitch Debug - Volume:', finalVolume.toFixed(2), 
                   'Pitch:', pitch ? pitch.toFixed(2) + 'Hz' : 'null', 
                   'Source:', pitchSource,
                   'Data range:', Math.min(...dataArray).toFixed(4), 'to', Math.max(...dataArray).toFixed(4));
      }
      
      // Accept pitch if found and in guitar range
      if (pitch && pitch >= 60 && pitch <= 2000) {
        console.log('🎵 GUITAR PITCH DETECTED:', pitch.toFixed(2), 'Hz via', pitchSource, 'at volume:', finalVolume.toFixed(2));
        setFrequency(pitch);
        
        const noteInfo = frequencyToNote(pitch);
        setNote(`${noteInfo.note}${noteInfo.octave}`);
        setCents(noteInfo.cents);
      } else {
        // Only clear if no pitch for a while and volume is low
        if (frequency > 0 && finalVolume < 1) {
          setFrequency(0);
          setNote('');
          setCents(0);
        }
      }

    } catch (error) {
      console.error('Error in analyzeAudio:', error);
    }
    
    // ALWAYS continue the loop regardless of state - this is the fix!
    if (window.audioLoopCount <= 10) {
      console.log('Scheduling next frame, isListening:', isListening);
    }
    
    // Continue animation loop
    animationFrameRef.current = requestAnimationFrame(analyzeAudio);
  };

  // Start/stop listening
  const toggleListening = async () => {
    try {
      if (!isListening) {
        // Try to initialize audio
        if (!permissionGranted) {
          const success = await initializeAudio();
          if (!success) return;
        }
        
        // Double check audio context state
        if (audioContextRef.current) {
          // On iOS, we need to resume the context on every user interaction
          if (audioContextRef.current.state === 'suspended') {
            await audioContextRef.current.resume();
            console.log('Audio context resumed on user interaction');
          }
          
          // Verify the context is actually running
          if (audioContextRef.current.state !== 'running') {
            console.error('Audio context failed to start:', audioContextRef.current.state);
            alert('Failed to start audio processing. Please try again.');
            return;
          }
        }
        
        setIsListening(true);
        console.log('Starting audio analysis...');
        
        // Reset counter for new session
        window.audioLoopCount = 0;
        
        // Start the loop
        analyzeAudio();
      } else {
        setIsListening(false);
        console.log('Stopping audio analysis...');
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
      }
    } catch (error) {
      console.error('Error in toggleListening:', error);
      alert('An error occurred while trying to start the tuner. Please reload the page and try again.');
      setIsListening(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Get tuning meter position (-100 to +100)
  const getTuningMeterPosition = () => {
    if (!frequency) return 0;
    
    const accuracy = getTuningAccuracy(frequency);
    if (accuracy) {
      return Math.max(-100, Math.min(100, accuracy.cents));
    }
    return 0;
  };

  const tuningAccuracy = frequency ? getTuningAccuracy(frequency) : null;
  const meterPosition = getTuningMeterPosition();

  return (
    <div className="guitar-tuner">
      {/* Header */}
      <div className="header">
        <h1 className="title">🎸 TonoTune</h1>
        <p className="subtitle">Guitar Tuner</p>
      </div>

      {!browserSupport.supported ? (
        <div style={{
          padding: '20px',
          margin: '20px 0',
          backgroundColor: 'rgba(255, 0, 0, 0.1)',
          border: '1px solid rgba(255, 0, 0, 0.3)',
          borderRadius: '8px',
          color: 'white',
          textAlign: 'center'
        }}>
          {browserSupport.message}
        </div>
      ) : (
        <>
          {/* Tuning Selection */}
          <div className="tuning-selector">
            <button 
              className={`tuning-btn ${selectedTuning === 'standard' ? 'active' : ''}`}
              onClick={() => setSelectedTuning('standard')}
            >
              Standard
            </button>
            <button 
              className={`tuning-btn ${selectedTuning === 'dropD' ? 'active' : ''}`}
              onClick={() => setSelectedTuning('dropD')}
            >
              Drop D
            </button>
          </div>

          {/* Main Tuning Display */}
          <div className="tuning-display">
            {/* Current Note */}
            <div className="note-display">
              <div className="note-name">{note || '--'}</div>
              <div className="frequency">{frequency ? `${frequency.toFixed(1)} Hz` : '--'}</div>
            </div>

            {/* Tuning Meter */}
            <div className="tuning-meter">
              <div className="meter-scale">
                <div className="scale-mark left">♭</div>
                <div className="scale-mark center">●</div>
                <div className="scale-mark right">♯</div>
              </div>
              <div className="meter-container">
                <div className="meter-track"></div>
                <div 
                  className={`meter-needle ${tuningAccuracy?.inTune ? 'in-tune' : ''}`}
                  style={{ 
                    left: `${50 + (meterPosition * 0.4)}%`,
                    opacity: frequency > 0 ? 1 : 0
                  }}
                ></div>
              </div>
              <div className="cents-display">
                {frequency > 0 && tuningAccuracy ? 
                  `${tuningAccuracy.cents > 0 ? '+' : ''}${tuningAccuracy.cents.toFixed(0)}¢` : 
                  '--'
                }
              </div>
            </div>

            {/* Target String Info */}
            {tuningAccuracy && (
              <div className="target-info">
                <div className="target-note">Target: {tuningAccuracy.targetNote}</div>
                <div className="target-string">String {tuningAccuracy.targetString}</div>
              </div>
            )}

            {/* Status Indicator */}
            <div className={`status-indicator ${tuningAccuracy?.inTune ? 'in-tune' : frequency > 0 ? 'tuning' : 'waiting'}`}>
              {tuningAccuracy?.inTune ? '✓ IN TUNE' : frequency > 0 ? 'TUNING...' : 'PLAY A STRING'}
            </div>
          </div>

          {/* Volume Indicator */}
          <div className="volume-indicator">
            <div className="volume-label">Input Level</div>
            <div className="volume-bar">
              <div 
                className="volume-fill"
                style={{ width: `${volume}%` }}
              ></div>
            </div>
          </div>

          {/* Control Button */}
          <div className="controls">
            <button 
              className={`listen-btn ${isListening ? 'listening' : ''}`}
              onClick={toggleListening}
            >
              {isListening ? '🎤 LISTENING...' : '🎤 START TUNING'}
            </button>
          </div>

          {/* String Reference */}
          <div className="string-reference">
            <h3>String Reference ({selectedTuning === 'standard' ? 'Standard' : 'Drop D'})</h3>
            <div className="strings-grid">
              {standardTuning[selectedTuning].map((string, index) => (
                <div key={index} className="string-item">
                  <div className="string-number">{string.string}</div>
                  <div className="string-note">{string.note}</div>
                  <div className="string-freq">{string.freq.toFixed(1)}Hz</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

function App() {
  return (
    <div className="App">
      <GuitarTuner />
      <footer style={{ textAlign: 'center', marginTop: 24, color: '#aaa', fontSize: '0.9rem' }}>
        Version: {packageJson.version}
      </footer>
    </div>
  );
}

export default App;