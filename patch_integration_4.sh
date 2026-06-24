sed -i '/<SafeAreaView style={styles.container}>/a \
      <SimulationResultSheet \n\
        isVisible={isSimulationVisible} \n\
        simulationResult={simulationResult} \n\
        onConfirm={handleConfirmSimulation} \n\
        onCancel={() => setIsSimulationVisible(false)} \n\
      />\n' src/screens/CryptoPaymentScreen.tsx
