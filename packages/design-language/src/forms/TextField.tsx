import type { InputHTMLAttributes, ReactNode } from 'react';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Field label rendered above the input. */
  label?: ReactNode;
}

/**
 * TextField — a labelled text input for cockpit forms, the ask-data entry and
 * login. 15px text (prevents iOS zoom), Ignition focus ring, sharp radius.
 */
export const TextField = ({ label, id, className, ...rest }: TextFieldProps) => {
  const inputId = id ?? rest.name;
  return (
    <div className={['rdl-field', className].filter(Boolean).join(' ')}>
      {label ? (
        <label className="rdl-field__label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <input id={inputId} className="rdl-input" {...rest} />
    </div>
  );
};
