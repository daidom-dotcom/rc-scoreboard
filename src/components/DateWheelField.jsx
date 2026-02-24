import DateWheel from './DateWheel';

export default function DateWheelField({ value, onChange, displayValue }) {
  return (
    <div className="field-unified">
      <DateWheel value={value} onChange={onChange} displayValue={displayValue} />
    </div>
  );
}
