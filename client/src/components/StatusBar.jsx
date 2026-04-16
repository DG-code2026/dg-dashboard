export default function StatusBar({ connected, primaryConnected }) {
  return (
    <div style={styles.wrapper}>
      <Indicator label="BACKEND" on={connected} />
      <Indicator label="PRIMARY WS" on={primaryConnected} />
    </div>
  );
}

function Indicator({ label, on }) {
  return (
    <div style={styles.item}>
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: on ? 'var(--neon)' : 'var(--red)',
          boxShadow: on ? 'var(--neon-glow)' : '0 0 6px var(--red-dim)',
          transition: 'all 0.3s',
        }}
      />
      <span style={{ ...styles.label, color: on ? 'var(--neon)' : 'var(--red)' }}>
        {label}
      </span>
    </div>
  );
}

const styles = {
  wrapper: {
    display: 'flex',
    gap: 20,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: 1.5,
  },
};
