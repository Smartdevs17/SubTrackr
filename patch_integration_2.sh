sed -i "/const handleCreateStream = async () => {/c \
  const handleConfirmSimulation = async () => {\n\
    setIsSimulationVisible(false);\n\
    await executeStreamCreation();\n\
  };\n\n\
  const executeStreamCreation = async () => {\n" src/screens/CryptoPaymentScreen.tsx
