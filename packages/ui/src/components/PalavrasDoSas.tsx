/**
 * The six words of the SAS, in large letters, one per line.
 *
 * It is the only thing the person compares between the two screens, so it is
 * the only thing this component does: split the words by hyphen and number
 * them, so "the third one is different" can be said out loud. No colors, no
 * icons, nothing that looks like a confirmation by itself.
 */
export function PalavrasDoSas({ palavras }: { palavras: string }): React.JSX.Element {
  return (
    <ol className="sas-palavras" data-palavras={palavras}>
      {palavras.split("-").map((palavra, i) => (
        <li key={`${i}-${palavra}`}>
          <span className="sas-numero" aria-hidden="true">
            {i + 1}
          </span>
          <span className="sas-palavra">{palavra}</span>
        </li>
      ))}
    </ol>
  )
}
