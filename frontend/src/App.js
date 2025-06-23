import React, { useState, useEffect, useRef } from 'react';
import * as Pitchfinder from 'pitchfinder';
import './App.css';

const GuitarTuner = () => {
  const [isListening, setIsListening] = useState(false);
  const [frequency, setFrequency] = useState(0);
  const [note, setNote] = useState('');
  const [cents, setCents] = useState(0);
  const [volume, setVolume] = useState(0);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [selectedTuning, setSelectedTuning] = useState('standard');

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

  // Initialize audio context and pitch detection
  const initializeAudio = async () => {
    try {
      console.log('Requesting microphone access...');
      
      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
          latency: 0
        } 
      });
      
      console.log('Microphone access granted, stream:', stream);
      streamRef.current = stream;
      setPermissionGranted(true);

      // Create audio context
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      console.log('Audio context created, sample rate:', audioContextRef.current.sampleRate);
      
      const source = audioContextRef.current.createMediaStreamSource(stream);
      console.log('Media stream source created');
      
      // Create analyser
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 4096;
      analyserRef.current.smoothingTimeConstant = 0.8;
      analyserRef.current.minDecibels = -90;
      analyserRef.current.maxDecibels = -10;
      source.connect(analyserRef.current);
      console.log('Analyser connected, fftSize:', analyserRef.current.fftSize);

      // Initialize pitch detection
      detectPitchRef.current = Pitchfinder.YIN({
        sampleRate: audioContextRef.current.sampleRate,
        threshold: 0.1
      });
      console.log('Pitch detection initialized');

      return true;
    } catch (error) {
      console.error('Error accessing microphone:', error);
      setPermissionGranted(false);
      return false;
    }
  };

  // Audio analysis loop
  const analyzeAudio = () => {
    if (!analyserRef.current || !detectPitchRef.current) {
      console.log('Missing analyser or pitch detector');
      return;
    }

    const bufferLength = analyserRef.current.fftSize;
    const dataArray = new Float32Array(bufferLength);
    analyserRef.current.getFloatTimeDomainData(dataArray);

    // Calculate volume (RMS) - more sensitive calculation
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / bufferLength);
    const currentVolume = Math.max(0, Math.min(100, rms * 100)); // Reduced multiplier
    setVolume(currentVolume);

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
    const finalVolume = Math.max(currentVolume, avgFreqVolume * 0.4);
    setVolume(finalVolume);

    // Debug: Log volume occasionally
    if (Math.random() < 0.01) { // Log 1% of the time
      console.log('Volume levels - RMS:', currentVolume.toFixed(2), 'Freq:', avgFreqVolume.toFixed(2), 'Final:', finalVolume.toFixed(2));
    }

    // Detect pitch with lower threshold
    if (finalVolume > 0.5) { // Much lower threshold
      const pitch = detectPitchRef.current(dataArray);
      
      if (pitch && pitch > 60 && pitch < 2000) { // Guitar frequency range
        console.log('Pitch detected:', pitch.toFixed(2), 'Hz');
        setFrequency(pitch);
        
        const noteInfo = frequencyToNote(pitch);
        setNote(`${noteInfo.note}${noteInfo.octave}`);
        setCents(noteInfo.cents);
      }
    } else {
      // Only clear if no volume for a while
      setFrequency(0);
      setNote('');
      setCents(0);
    }

    if (isListening) {
      animationFrameRef.current = requestAnimationFrame(analyzeAudio);
    }
  };

  // Start/stop listening
  const toggleListening = async () => {
    if (!isListening) {
      if (!permissionGranted) {
        const success = await initializeAudio();
        if (!success) return;
      }
      
      // Always try to resume audio context
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        console.log('Resuming suspended audio context...');
        await audioContextRef.current.resume();
        console.log('Audio context state:', audioContextRef.current.state);
      }
      
      setIsListening(true);
      console.log('Starting audio analysis...');
      analyzeAudio();
    } else {
      setIsListening(false);
      console.log('Stopping audio analysis...');
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
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
    </div>
  );
};

function App() {
  return (
    <div className="App">
      <GuitarTuner />
    </div>
  );
}

export default App;