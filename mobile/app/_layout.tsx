import { Stack } from 'expo-router';
import { ThemeProvider } from '../features/theme/ThemeProvider';
import { AuthProvider } from '../features/auth/context/AuthContext';

export default function RootLayout() {
    return (
        <ThemeProvider>
            <AuthProvider>
                <Stack
                    screenOptions={{
                        headerShown: false,
                        contentStyle: { backgroundColor: '#fff' },
                    }}
                >
                    {/* Auth Screens */}
                    <Stack.Screen name="auth" options={{ headerShown: false }} />

                    {/* Main App */}
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

                    {/* Modals */}
                    <Stack.Screen
                        name="modal"
                        options={{ presentation: 'modal', headerShown: true }}
                    />
                </Stack>
            </AuthProvider>
        </ThemeProvider>
    );
}