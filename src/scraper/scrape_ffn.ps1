<#
.SYNOPSIS
    Scrape resultats de competition du club de natation ACS CORMEILLES (id FFN 733)
    depuis ffn.extranat.fr (backend officiel FFN) et liveffn.com (listes de depart / adversaires).

.DESCRIPTION
    Ce script ne parse QUE du HTML brut recu via Invoke-WebRequest -UseBasicParsing (aucun moteur
    DOM/JS disponible sur cette machine en mode non-interactif) : on utilise donc des regex .NET.

    Sources et endpoints identifies (session de decouverte du 2026-07-19) :

    1) Recherche de club (autocomplete AJAX, retourne du JSON) :
         GET https://ffn.extranat.fr/webffn/_recherche.php?go=clt&idtrt=str&idrch=<texte>&idsai=<saison>
         -> [{"id":"733","label":"ACS CORMEILLES","color":null}]

    2) Calendrier des competitions par departement/region (HTML) :
         GET https://ffn.extranat.fr/webffn/competitions.php?idact=nat&idsai=<saison>&iddep=<iddep>&idmth=<mois 1-12>
         GET https://ffn.extranat.fr/webffn/competitions.php?idact=nat&idsai=<saison>&idreg=<idreg>&idmth=<mois 1-12>
       -> contient des liens resultats.php?idact=nat&idcpt=<idcpt> avec dates/lieux.
       iddep Val-d'Oise = 1633, idreg Ile-de-France = 1592.

    3) Resultats d'une competition filtres sur le club (HTML, SANS JS - c'est la source principale) :
         GET https://ffn.extranat.fr/webffn/resultats.php?idact=nat&idcpt=<idcpt>&go=res&idclb=733
       -> Pour chaque nageur du club: bloc <thead bg-pink-600> avec id FFN (idnat), nom, prenom,
          annee de naissance, age, sexe (icone venus/mars), suivi de <tr> par performance :
          rang, epreuve, serie/finale, temps (ou DSQ/DNS dec), points, indicateur nouveau record.

       IMPORTANT : nat_perfs.php et nat_rankings.php (pistes suggerees initialement) ne conviennent
       PAS pour lister le roster : ce sont des outils de classement/annuaire qui necessitent un POST
       complexe et ne listent pas simplement "les nageurs du club". La methode la plus fiable pour
       obtenir a la fois le roster ET les resultats reels est de scraper resultats.php par
       competition (chaque nageur qui a couru apparait avec identite + performances) : on derive
       le roster comme union des nageurs rencontres sur les competitions recentes. Cela evite aussi
       d'inventer une liste de "licencies" qu'on ne peut pas verifier publiquement.

    4) liveffn.com (listes de depart / adversaires pour competitions a venir) :
       Les idcpt sont PARTAGES entre ffn.extranat.fr et liveffn.com (meme identifiant numerique).
         GET https://www.liveffn.com/cgi-bin/programme.php?competition=<idcpt>&langue=fra   (programme/ordre des epreuves)
         GET https://www.liveffn.com/cgi-bin/liste_entree.php?competition=<idcpt>&langue=fra (liste des engages)
         GET https://www.liveffn.com/cgi-bin/startlist.php?competition=<idcpt>&langue=fra    (liste de depart = series/couloirs/horaires)
       LIMITATION CONSTATEE : ces trois pages affichent un message "non disponible actuellement,
       sera publie a l'issue de la reunion technique" tant que la reunion technique n'a pas eu lieu
       (generalement la veille ou le matin meme de la competition). Il n'existe donc PAS de moyen
       d'obtenir couloirs/horaires/adversaires plusieurs jours a l'avance. Le script tente quand
       meme ces pages pour chaque competition a venir trouvee et remplit "upcoming"/"opponents"
       UNIQUEMENT si des donnees reelles sont publiees - jamais de valeurs inventees.

.OUTPUTS
    club_data.json (a cote de ce script) conforme au schema demande par le club.

.NOTES
    Respect du site : Start-Sleep -Milliseconds 300 entre chaque requete sequentielle.
#>

[CmdletBinding()]
param(
    [int]$ClubId = 733,
    [string]$ClubName = "ACS Cormeilles Natation",
    [int]$DeptId = 1633,     # VAL-D'OISE
    [int]$RegionId = 1592,   # ILE-DE-FRANCE
    [int]$MonthsBack = 2,    # combien de mois en arriere on inspecte pour trouver des competitions passees
    [int]$MonthsForward = 1, # combien de mois en avant on inspecte pour trouver des competitions a venir
    [int]$MaxPastCompetitions = 3,   # nombre de competitions passees a scraper en detail (saison en cours uniquement)
    [string]$OutFile = "C:\Users\DELL\AppData\Local\Temp\claude\C--Users-DELL\e75501a5-45b3-40b3-b39e-57bf323ef5db\scratchpad\club_data.json",
    [switch]$VerboseLog
)

$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$baseExtranat = "https://ffn.extranat.fr/webffn"
$baseLiveffn  = "https://www.liveffn.com/cgi-bin"

function Write-Log($msg) {
    if ($VerboseLog) { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $msg" }
}

function Get-FfnSaison([datetime]$date) {
    # Saison FFN = "idsai". Sept -> Aout de l'annee suivante porte le nom de l'annee de fin.
    # Ex: Septembre 2025 a Aout 2026 => idsai=2026
    if ($date.Month -ge 9) { return $date.Year + 1 } else { return $date.Year }
}

$MonthNumFr = @{
    'janvier'=1;'février'=2;'fevrier'=2;'mars'=3;'avril'=4;'mai'=5;'juin'=6;
    'juillet'=7;'août'=8;'aout'=8;'septembre'=9;'octobre'=10;'novembre'=11;'décembre'=12;'decembre'=12
}

function ConvertTo-IsoDate([string]$frenchDateText) {
    # Extrait la PREMIERE date "jour MoisEnLettres annee" trouvee dans un texte francais
    # (gere "Le Dimanche 25 Janvier 2026" et "Du Samedi 16 au Dimanche 17 Mai 2026" -> garde le debut)
    if (-not $frenchDateText) { return $null }
    $m = [regex]::Match($frenchDateText, '(\d{1,2})\s+(\p{L}+)\s+(\d{4})')
    if (-not $m.Success) { return $null }
    $day = [int]$m.Groups[1].Value
    $monKey = $m.Groups[2].Value.ToLower()
    if (-not $MonthNumFr.ContainsKey($monKey)) {
        # fallback sans accents
        $ascii = $monKey -replace '[éè]','e' -replace 'û','u' -replace 'ô','o'
        if ($MonthNumFr.ContainsKey($ascii)) { $monKey = $ascii } else { return $null }
    }
    $mon = $MonthNumFr[$monKey]
    $year = [int]$m.Groups[3].Value
    return ('{0:D4}-{1:D2}-{2:D2}' -f $year, $mon, $day)
}

function Invoke-Ffn([string]$Url) {
    # Respect du site : throttling + backoff si on declenche un 403 (rate-limit temporaire
    # observe lors des tests : le site bloque un moment en cas de rafale de requetes, puis
    # se debloque de lui-meme apres quelques minutes). On espace TOUJOURS les requetes et on
    # retente une seule fois apres une pause longue en cas de 403/429.
    Write-Log "GET $Url"
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 30
    } catch {
        $status = $null
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        if ($status -eq 403 -or $status -eq 429) {
            Write-Log "Rate-limit possible (HTTP $status) sur $Url - pause de 60s puis nouvelle tentative..."
            Start-Sleep -Seconds 60
            $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 30
        } else {
            throw
        }
    }
    Start-Sleep -Milliseconds 700
    return $resp.Content
}

function Find-CompetitionIds {
    <#
        Parcourt competitions.php sur une fenetre de mois (departement + region) et renvoie
        la liste unique des idcpt trouves, avec le mois interroge (pour info/logs).
    #>
    param(
        [int]$MonthsBack,
        [int]$MonthsForward
    )
    $today = Get-Date
    $ids = New-Object System.Collections.Generic.HashSet[string]
    for ($offset = -$MonthsBack; $offset -le $MonthsForward; $offset++) {
        $d = $today.AddMonths($offset)
        $mth = $d.Month
        $sai = Get-FfnSaison $d
        foreach ($filter in @(@{name='iddep';val=$DeptId}, @{name='idreg';val=$RegionId})) {
            $url = "$baseExtranat/competitions.php?idact=nat&idsai=$sai&$($filter.name)=$($filter.val)&idmth=$mth"
            try {
                $html = Invoke-Ffn $url
                $idMatches = [regex]::Matches($html, 'idcpt=(\d+)')
                foreach ($mm in $idMatches) { [void]$ids.Add($mm.Groups[1].Value) }
            } catch {
                Write-Log "Echec recuperation $url : $($_.Exception.Message)"
            }
        }
    }
    return $ids
}

function Test-ClubParticipation {
    <# Renvoie le HTML de resultats.php filtre par club si le club y apparait, sinon $null #>
    param([string]$IdCpt)
    $url = "$baseExtranat/resultats.php?idact=nat&idcpt=$IdCpt&go=res&idclb=$ClubId"
    try {
        $html = Invoke-Ffn $url
        if ($html -match 'ACS CORMEILLES') { return $html }
        return $null
    } catch {
        Write-Log "Echec test participation idcpt=$IdCpt : $($_.Exception.Message)"
        return $null
    }
}

function Get-CompetitionMeta {
    param([string]$Html, [string]$IdCpt)
    $h3 = [regex]::Match($Html, '<h3 class="text-lg font-bold text-gray-900 sm:text-2xl">([^<]+)</h3>')
    $title = $null; $location = $null
    if ($h3.Success) {
        $full = [System.Net.WebUtility]::HtmlDecode($h3.Groups[1].Value.Trim())
        $idx = $full.LastIndexOf(' - ')
        if ($idx -gt 0) {
            $title = $full.Substring(0, $idx).Trim()
            $location = $full.Substring($idx + 3).Trim() -replace '\s*\(FRA\)\s*$', ''
        } else {
            $title = $full
        }
    }
    $dateP = [regex]::Match($Html, '<p class="font-bold text-blue-600">([^<]+)<')
    $isoDate = $null
    if ($dateP.Success) { $isoDate = ConvertTo-IsoDate ([System.Net.WebUtility]::HtmlDecode($dateP.Groups[1].Value)) }
    return [PSCustomObject]@{
        idcpt    = $IdCpt
        name     = $title
        location = $location
        date     = $isoDate
    }
}

function ConvertFrom-ClubResultsHtml {
    <#
        Extrait, pour un HTML de resultats.php filtre club, la liste des nageurs et leurs
        performances. Renvoie un tableau d'objets swimmer {idnat, name, birthYear, gender, results[]}
    #>
    param([string]$Html, [PSCustomObject]$CompMeta)

    $swimmerHeaderRegex = [regex]'<span id="(?<idnat>\d+)"></span>\s*<span>(?<name>[^<(]+?)\s*\((?<byear>\d{4})/(?<age>\d+)\s*ans\)\s*<i class="fa fa-(?<gender>venus|mars)">'
    $headers = $swimmerHeaderRegex.Matches($Html)

    # Chaque performance est une ligne <tr class="border-b..."> contenant exactement 9 <td>.
    # On extrait generiquement le contenu de chaque <td> (plutot que de figer les attributs
    # class= exacts) pour rester robuste aux petites variations de mise en forme HTML :
    #   0=rang  1=epreuve(lien)  2=serie/finale  3=couloir/serie-detail  4=temps
    #   5=temps de reaction  6=points  7=(vide)  8=icone de statut (ex: nouveau record)
    $trRegex = New-Object System.Text.RegularExpressions.Regex(
        '<tr class="border-b[^"]*">(?<body>.*?)</tr>',
        [System.Text.RegularExpressions.RegexOptions]::Singleline)
    $tdRegex = New-Object System.Text.RegularExpressions.Regex(
        '<td[^>]*>(?<c>.*?)</td>',
        [System.Text.RegularExpressions.RegexOptions]::Singleline)
    $tagStrip = [regex]'<[^>]+>'

    function Get-PlainText([string]$fragment) {
        $t = $tagStrip.Replace($fragment, ' ')
        $t = [System.Net.WebUtility]::HtmlDecode($t)
        return ($t -replace '\s+', ' ').Trim()
    }

    $swimmers = @()
    for ($i = 0; $i -lt $headers.Count; $i++) {
        $h = $headers[$i]
        $sectionStart = $h.Index + $h.Length
        $sectionEnd = if ($i + 1 -lt $headers.Count) { $headers[$i+1].Index } else { $Html.Length }
        $section = $Html.Substring($sectionStart, $sectionEnd - $sectionStart)

        $name = [System.Net.WebUtility]::HtmlDecode($h.Groups['name'].Value.Trim())
        $idnat = $h.Groups['idnat'].Value
        $byear = [int]$h.Groups['byear'].Value
        $gender = if ($h.Groups['gender'].Value -eq 'venus') { 'F' } else { 'M' }

        $results = @()
        foreach ($trm in $trRegex.Matches($section)) {
            $tds = @($tdRegex.Matches($trm.Groups['body'].Value))
            if ($tds.Count -lt 9) { continue }

            $rankRaw = Get-PlainText $tds[0].Groups['c'].Value
            $eventRaw = Get-PlainText $tds[1].Groups['c'].Value
            $sessionRaw = Get-PlainText $tds[2].Groups['c'].Value
            $rawTime = Get-PlainText $tds[4].Groups['c'].Value
            $statusIconHtml = $tds[8].Groups['c'].Value

            if ([string]::IsNullOrWhiteSpace($eventRaw)) { continue }

            $status = 'OK'
            $time = $rawTime
            if ($rawTime -match '^DSQ') { $status = 'DSQ'; $time = $null }
            elseif ($rawTime -match '^DNS') { $status = 'DNS'; $time = $null }
            elseif ($rawTime -match '^(NP|Abs|AB)\b') { $status = 'DNS'; $time = $null }
            elseif ([string]::IsNullOrWhiteSpace($rawTime)) { $status = 'DNS'; $time = $null }

            $rank = $null
            if ($rankRaw -match '^\d+') { $rank = [int]([regex]::Match($rankRaw, '^\d+').Value) }

            $isPB = $statusIconHtml -match 'Nouvelle performance établie'

            $results += [PSCustomObject]@{
                competitionId   = $CompMeta.idcpt
                competitionName = $CompMeta.name
                date            = $CompMeta.date
                location        = $CompMeta.location
                event           = $eventRaw
                session         = $sessionRaw
                time            = $time
                rank            = $rank
                status          = $status
                isPB            = [bool]$isPB
            }
        }

        $swimmers += [PSCustomObject]@{
            idnat     = $idnat
            name      = $name
            birthYear = $byear
            gender    = $gender
            results   = $results
        }
    }
    return $swimmers
}

function Get-LiveffnStatus {
    <#
        Tente de recuperer une liste de depart (adversaires/couloirs/horaires) pour une
        competition a venir sur liveffn.com. Renvoie $null si non publiee (cas normal avant
        la reunion technique) - on n'invente jamais de couloir/horaire.
    #>
    param([string]$IdCpt)
    $url = "$baseLiveffn/startlist.php?competition=$IdCpt&langue=fra"
    try {
        $html = Invoke-Ffn $url
        if ($html -match "n'est pas disponible actuellement" -or $html -match 'sera publiée') {
            return $null
        }
        # Liste de depart publiee : structure non observee lors du developpement (aucune
        # competition du club n'avait de liste de depart publiee au moment du scraping).
        # On renvoie le HTML brut pour une extraction ulterieure une fois la structure connue.
        return $html
    } catch {
        return $null
    }
}

# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

Write-Log "Verification du club $ClubId via _recherche.php..."
$searchUrl = "$baseExtranat/_recherche.php?go=clt&idtrt=str&idrch=CORMEILLES&idsai=$(Get-FfnSaison (Get-Date))"
try {
    $searchJson = Invoke-Ffn $searchUrl | ConvertFrom-Json
    $match733 = $searchJson | Where-Object { $_.id -eq "$ClubId" }
    if ($match733) { Write-Log "Club confirme : $($match733.label) (id=$($match733.id))" }
} catch {
    Write-Log "Recherche club echouee (non bloquant) : $($_.Exception.Message)"
}

Write-Log "Decouverte des competitions (departement=$DeptId, region=$RegionId, fenetre=-$MonthsBack/+$MonthsForward mois)..."
$candidateIds = Find-CompetitionIds -MonthsBack $MonthsBack -MonthsForward $MonthsForward
Write-Log "Competitions candidates trouvees : $($candidateIds.Count)"

$today = Get-Date
$pastMatches = @()
$futureMatches = @()

foreach ($idcpt in $candidateIds) {
    $html = Test-ClubParticipation -IdCpt $idcpt
    if (-not $html) { continue }
    $meta = Get-CompetitionMeta -Html $html -IdCpt $idcpt
    if (-not $meta.date) { continue }
    $compDate = [datetime]::ParseExact($meta.date, 'yyyy-MM-dd', $null)
    if ($compDate -le $today) {
        $pastMatches += [PSCustomObject]@{ meta = $meta; html = $html }
    } else {
        $futureMatches += [PSCustomObject]@{ meta = $meta }
    }
}

Write-Log "Competitions passees avec ACS CORMEILLES : $($pastMatches.Count)"
Write-Log "Competitions a venir avec ACS CORMEILLES deja identifiees au calendrier : $($futureMatches.Count)"

$pastMatches = $pastMatches | Sort-Object { $_.meta.date } -Descending
$selectedPast = $pastMatches | Select-Object -First $MaxPastCompetitions

# --- Agregation du roster + resultats ---
$swimmersById = @{}

foreach ($pm in $selectedPast) {
    Write-Log "Extraction resultats : $($pm.meta.idcpt) - $($pm.meta.name) ($($pm.meta.date))"
    $swimmers = ConvertFrom-ClubResultsHtml -Html $pm.html -CompMeta $pm.meta
    foreach ($sw in $swimmers) {
        $key = if ($sw.idnat) { $sw.idnat } else { ($sw.name -replace '\s+','_').ToLower() }
        if (-not $swimmersById.ContainsKey($key)) {
            $swimmersById[$key] = [PSCustomObject]@{
                id        = $key
                name      = $sw.name
                birthYear = $sw.birthYear
                gender    = $sw.gender
                results   = New-Object System.Collections.Generic.List[object]
                upcoming  = New-Object System.Collections.Generic.List[object]
            }
        }
        foreach ($r in $sw.results) { $swimmersById[$key].results.Add($r) }
    }
}

# --- Competitions a venir : tenter startlist/opponents sans jamais inventer de donnees ---
foreach ($fm in $futureMatches) {
    Write-Log "Verification liste de depart pour competition a venir : $($fm.meta.idcpt) - $($fm.meta.name) ($($fm.meta.date))"
    $startlistHtml = Get-LiveffnStatus -IdCpt $fm.meta.idcpt
    if ($startlistHtml) {
        Write-Log "  -> Liste de depart PUBLIEE pour idcpt=$($fm.meta.idcpt) - extraction non implementee (structure a valider manuellement), voir HTML brut."
        # NOTE: aucune competition rencontree lors du developpement n'avait de liste de depart
        # publiee (toujours "sera publiee a l'issue de la reunion technique"). Si ce cas se
        # presente en usage reel, completer ici le parsing de $startlistHtml pour peupler
        # $swimmersById[...].upcoming avec heat/lane/scheduledTime/opponents reels.
    } else {
        Write-Log "  -> Liste de depart non disponible (normal avant la reunion technique)."
    }
}

$swimmersOut = New-Object System.Collections.Generic.List[object]
foreach ($sw in $swimmersById.Values) {
    try {
        # NB: "@($genericList)" leve une ArgumentException dans cet environnement PowerShell 5.1
        # lorsque la liste est vide (bug constate empiriquement) -> on utilise .ToArray() a la place.
        $obj = [PSCustomObject]@{
            id        = $sw.id
            name      = $sw.name
            birthYear = $sw.birthYear
            gender    = $sw.gender
            results   = $sw.results.ToArray()
            upcoming  = $sw.upcoming.ToArray()
        }
        $swimmersOut.Add($obj)
    } catch {
        Write-Host "ECHEC construction nageur id=$($sw.id) name=$($sw.name) : $($_.Exception.Message)"
        throw
    }
}
$swimmersOut = @($swimmersOut | Sort-Object name)

$output = [PSCustomObject]@{
    club = [PSCustomObject]@{
        id          = $ClubId
        name        = $ClubName
        lastUpdated = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
    swimmers = @($swimmersOut)
}

$json = $output | ConvertTo-Json -Depth 8
$json | Out-File -FilePath $OutFile -Encoding utf8

$totalResults = ($swimmersOut | ForEach-Object { $_.results.Count } | Measure-Object -Sum).Sum
Write-Host "Termine. $($swimmersOut.Count) nageurs, $totalResults resultats, ecrits dans $OutFile"
$compSummary = ($selectedPast | ForEach-Object { "$($_.meta.idcpt):$($_.meta.date)" }) -join ', '
Write-Host "Competitions scrapees : $compSummary"
