sed -i "/const validateForm = (): boolean => {/i \
  const handleCreateStream = async () => {\n\
    if (!validateForm()) return;\n\
    if (!isWalletConnected(connection)) {\n\
      Alert.alert('Error', 'Wallet not connected');\n\
      return;\n\
    }\n\
    \n\
    setIsLoading(true);\n\
    try {\n\
      // Use Soroban simulation on stellar networks as an example if it's stellar\n\
      // Our payload needs xdr. We will mock the xdr generation for demonstration.\n\
      const mockXdr = 'mock_transaction_xdr';\n\
      const sim = await transactionSimulationService.simulateTransaction({\n\
        network: 'testnet',\n\
        transactionXdr: mockXdr\n\
      });\n\
      setSimulationResult(sim);\n\
      setIsSimulationVisible(true);\n\
    } catch (e) {\n\
      console.warn('Simulation skipped:', e);\n\
      // Fallback\n\
      await executeStreamCreation();\n\
    } finally {\n\
      setIsLoading(false);\n\
    }\n\
  };\n\
" src/screens/CryptoPaymentScreen.tsx
