import { useState, useCallback, useMemo } from 'react';
import type { Feature, Geometry } from 'geojson';
import { ChatPanel } from './components/ChatPanel';
import { MapView } from './components/MapView';
import { ResultsPanel } from './components/ResultsPanel';
import { sendChatMessage, ApiClientError } from './lib/api';
import { getChoroplethConfig } from './lib/choropleth';
import type { ChatMessage, StructuredQuery } from './types/api';
import './App.css';

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [features, setFeatures] = useState<
    Feature<Geometry, Record<string, unknown>>[]
  >([]);
  const [selectedFeature, setSelectedFeature] = useState<Feature<
    Geometry,
    Record<string, unknown>
  > | null>(null);
  const [currentQuery, setCurrentQuery] = useState<StructuredQuery | null>(
    null
  );
  const [explanation, setExplanation] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);

  const handleSendMessage = useCallback(async (content: string) => {
    // Add user message
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const response = await sendChatMessage(content);

      // Add assistant response
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.explanation,
        timestamp: new Date(),
        query: response.query,
        result: response.result,
        metadata: response.metadata,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setFeatures(response.result.features);
      setCurrentQuery(response.query);
      setExplanation(response.explanation);
      setShowResults(true);
      setSelectedFeature(null);
    } catch (error) {
      let errorMessage = 'An unexpected error occurred';
      let content = 'Sorry, I encountered an error processing your request.';

      if (error instanceof ApiClientError) {
        errorMessage = error.message;
        if (error.details) {
          errorMessage += `: ${error.details}`;
        }
        // If we have suggestions, make the message more helpful
        if (error.suggestions && error.suggestions.length > 0) {
          content = `I couldn't complete that request. ${error.details || error.message}\n\nHere are some suggestions:\n• ${error.suggestions.join('\n• ')}`;
          errorMessage = ''; // Don't show duplicate error
        }
      }

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content,
        timestamp: new Date(),
        error: errorMessage || undefined,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleFeatureClick = useCallback(
    (feature: Feature<Geometry, Record<string, unknown>>) => {
      setSelectedFeature(feature);
      setShowResults(true);
    },
    []
  );

  const handleFeatureSelect = useCallback(
    (feature: Feature<Geometry, Record<string, unknown>> | null) => {
      setSelectedFeature(feature);
    },
    []
  );

  const handleCloseResults = useCallback(() => {
    setShowResults(false);
    setSelectedFeature(null);
  }, []);

  // Compute choropleth configuration based on current query and features
  const choroplethConfig = useMemo(() => {
    const config = getChoroplethConfig(currentQuery, features);
    console.log('Choropleth config:', {
      layer: currentQuery?.selectLayer,
      featureCount: features.length,
      config
    });
    return config;
  }, [currentQuery, features]);

  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <ChatPanel
          messages={messages}
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
        />
      </aside>
      <main className="app-main">
        <MapView
          features={features}
          selectedFeature={selectedFeature}
          onFeatureClick={handleFeatureClick}
          choroplethConfig={choroplethConfig}
        />
      </main>
      {showResults && (
        <aside className="app-results">
          <ResultsPanel
            features={features}
            selectedFeature={selectedFeature}
            query={currentQuery}
            explanation={explanation}
            onFeatureSelect={handleFeatureSelect}
            onClose={handleCloseResults}
          />
        </aside>
      )}
    </div>
  );
}

export default App;
