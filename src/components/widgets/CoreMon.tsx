import React, { useState, useEffect } from 'react';

// Data types for the monitor
interface Metrics {
  cpu: number;
  ram: number;
  netRx: number;
  netTx: number;
}

export const CoreMon: React.FC = () => {
  const [metrics, setMetrics] = useState<Metrics>({
    cpu: 0,
    ram: 0,
    netRx: 0,
    netTx: 0,
  });

  useEffect(() => {
    // Fluctuate metrics every 1000ms
    const interval = setInterval(() => {
      setMetrics({
        cpu: Math.floor(Math.random() * 101), // 0-100
        ram: Math.floor(Math.random() * 64) + 4, // 4-68 GB
        netRx: Math.floor(Math.random() * 500) + 10, // 10-510 Mbps
        netTx: Math.floor(Math.random() * 200) + 5, // 5-205 Mbps
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>SYS_CORE_MON</h2>
        <div style={styles.statusBlinker}></div>
      </div>

      <div style={styles.grid}>
        {/* CPU Monitor */}
        <div style={styles.card}>
          <div style={styles.cardLabel}>CPU_LOAD</div>
          <div style={styles.cardValueContainer}>
            <span style={styles.cardValue}>{metrics.cpu.toString().padStart(3, '0')}</span>
            <span style={styles.unit}>%</span>
          </div>
          <div style={styles.barContainer}>
            <div style={{ ...styles.barFill, width: `${metrics.cpu}%`, backgroundColor: metrics.cpu > 80 ? '#FF003C' : '#FCEE0A' }}></div>
          </div>
        </div>

        {/* RAM Monitor */}
        <div style={styles.card}>
          <div style={styles.cardLabel}>MEM_ALLOC</div>
          <div style={styles.cardValueContainer}>
            <span style={styles.cardValue}>{metrics.ram.toString().padStart(2, '0')}</span>
            <span style={styles.unit}>GB</span>
          </div>
          <div style={styles.barContainer}>
            <div style={{ ...styles.barFill, width: `${(metrics.ram / 64) * 100}%`, backgroundColor: '#00F0FF' }}></div>
          </div>
        </div>

        {/* Network I/O */}
        <div style={{ ...styles.card, gridColumn: 'span 2' }}>
          <div style={styles.cardLabel}>NET_I/O (RX/TX)</div>
          <div style={styles.netGrid}>
            <div>
              <div style={styles.netDirection}>RX</div>
              <div style={styles.cardValueContainer}>
                <span style={styles.cardValue}>{metrics.netRx.toString().padStart(3, '0')}</span>
                <span style={styles.unit}>MB/S</span>
              </div>
            </div>
            <div>
              <div style={styles.netDirection}>TX</div>
              <div style={styles.cardValueContainer}>
                <span style={styles.cardValue}>{metrics.netTx.toString().padStart(3, '0')}</span>
                <span style={styles.unit}>MB/S</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>
        {`
          @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0; }
          }
        `}
      </style>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    backgroundColor: '#000000',
    border: '4px solid #FFFFFF',
    padding: '24px',
    boxShadow: '8px 8px 0px 0px #FF003C',
    width: '100%',
    maxWidth: '500px',
    boxSizing: 'border-box',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '4px solid #FFFFFF',
    paddingBottom: '16px',
    marginBottom: '24px',
  },
  title: {
    margin: 0,
    fontSize: '24px',
    fontWeight: 900,
    letterSpacing: '2px',
    color: '#FCEE0A',
  },
  statusBlinker: {
    width: '16px',
    height: '16px',
    backgroundColor: '#FF003C',
    border: '2px solid #FFFFFF',
    animation: 'blink 1s step-end infinite',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  card: {
    border: '3px solid #FFFFFF',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    backgroundColor: '#111111',
  },
  cardLabel: {
    fontSize: '14px',
    fontWeight: 800,
    color: '#AAAAAA',
    letterSpacing: '1px',
  },
  cardValueContainer: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '4px',
  },
  cardValue: {
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: '36px',
    fontWeight: 900,
    color: '#FFFFFF',
  },
  unit: {
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: '16px',
    fontWeight: 700,
    color: '#FCEE0A',
  },
  barContainer: {
    height: '16px',
    width: '100%',
    border: '2px solid #FFFFFF',
    backgroundColor: '#000000',
    position: 'relative',
  },
  barFill: {
    height: '100%',
    transition: 'width 0.2s ease-out, background-color 0.2s ease-out',
  },
  netGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  netDirection: {
    fontSize: '12px',
    fontWeight: 800,
    color: '#00F0FF',
    marginBottom: '4px',
  }
};
