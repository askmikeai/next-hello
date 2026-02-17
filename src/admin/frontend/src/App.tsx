import { useState } from 'react';
import Layout from './components/Layout';
import Overview from './components/Overview';
import Swarm from './components/Swarm';

type Tab = 'overview' | 'swarm';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'overview' && <Overview />}
      {activeTab === 'swarm' && <Swarm />}
    </Layout>
  );
}

export default App;
