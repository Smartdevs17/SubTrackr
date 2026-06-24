sed -i "/console.error('Failed to create stream:', error);/a \      transactionSimulationService.handleSubmissionError(error);" src/screens/CryptoPaymentScreen.tsx
