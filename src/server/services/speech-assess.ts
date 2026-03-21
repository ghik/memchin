import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

export interface SpeechAssessResult {
  accuracyScore: number;
}

export function isSpeechAssessAvailable(): boolean {
  return !!(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);
}

export function assessPronunciation(
  pcmBuffer: Buffer,
  referenceText: string
): Promise<SpeechAssessResult> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) {
    throw new Error('AZURE_SPEECH_KEY and AZURE_SPEECH_REGION must be set');
  }

  return new Promise((resolve, reject) => {
    const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
    speechConfig.speechRecognitionLanguage = 'zh-CN';

    const pronunciationConfig = new sdk.PronunciationAssessmentConfig(
      referenceText,
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Phoneme,
      false
    );

    const format = sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
    const pushStream = sdk.AudioInputStream.createPushStream(format);

    const arrayBuffer = new ArrayBuffer(pcmBuffer.byteLength);
    new Uint8Array(arrayBuffer).set(pcmBuffer);
    pushStream.write(arrayBuffer);
    pushStream.close();

    const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    pronunciationConfig.applyTo(recognizer);

    recognizer.recognizeOnceAsync(
      (result) => {
        if (result.reason === sdk.ResultReason.RecognizedSpeech) {
          const pronResult = sdk.PronunciationAssessmentResult.fromResult(result);
          resolve({ accuracyScore: pronResult.accuracyScore });
        } else if (result.reason === sdk.ResultReason.NoMatch) {
          resolve({ accuracyScore: 0 });
        } else {
          reject(new Error(`Speech recognition failed: ${result.reason}`));
        }
        recognizer.close();
      },
      (err) => {
        recognizer.close();
        reject(err);
      }
    );
  });
}
