// --- METEOCOMPARE STATIC CLIENT SIDE LOGIC ---

let groupedForecastData = []; // [{ dateStr, averageHours: [], providerHours: { providerName: [] } }]
let selectedDayIndex = 0;
let tempChart = null;
let currentChartType = 'temp'; // 'temp' o 'prec'

// Nomi e URL base dei 5 modelli meteorologici
const PROVIDERS = [
    { name: "ECMWF (Europeo)", endpoint: "https://api.open-meteo.com/v1/ecmwf?" },
    { name: "DWD ICON (Tedesco)", endpoint: "https://api.open-meteo.com/v1/dwd-icon?" },
    { name: "NOAA GFS (USA)", endpoint: "https://api.open-meteo.com/v1/gfs?" },
    { name: "CMC GEM (Canadese)", endpoint: "https://api.open-meteo.com/v1/gem?" },
    { name: "MeteoFrance (Francese)", endpoint: "https://api.open-meteo.com/v1/meteofrance?" },
    { name: "MeteoSwiss (Svizzero)", endpoint: "https://api.open-meteo.com/v1/forecast?models=meteoswiss_icon_ch2&" }
];

document.addEventListener("DOMContentLoaded", () => {
    // Inizializza l'autocompletamento della ricerca
    initAutocomplete();
    
    // Inizializza i toggle per il tipo di grafico
    document.getElementById("btnChartTemp").addEventListener("click", () => {
        setChartType('temp');
    });
    document.getElementById("btnChartPrec").addEventListener("click", () => {
        setChartType('prec');
    });

    // Recupera l'ultima località salvata nel cookie, altrimenti usa Roma come default
    const savedLocation = getSavedLocationCookie();
    if (savedLocation) {
        loadForecast(savedLocation.lat, savedLocation.lon, savedLocation.name, savedLocation.region);
    } else {
        loadForecast(41.8903, 12.4942, "Roma", "Lazio, Italia");
    }
});

// --- GESTIONE COOKIE E LOCALSTORAGE PER LA LOCALITÀ ---
function setSavedLocationCookie(lat, lon, name, region) {
    const value = JSON.stringify({ lat, lon, name, region });
    
    // 1. Salva in localStorage (estremamente affidabile anche su file://)
    try {
        localStorage.setItem("last_location", value);
    } catch(e) {
        console.warn("localStorage non disponibile:", e);
    }

    // 2. Salva nel Cookie tradizionale per 30 giorni
    const d = new Date();
    d.setTime(d.getTime() + (30 * 24 * 60 * 60 * 1000));
    const expires = "expires=" + d.toUTCString();
    document.cookie = "last_location=" + encodeURIComponent(value) + ";" + expires + ";path=/;SameSite=Lax";
}

function getSavedLocationCookie() {
    // 1. Tenta prima la lettura da localStorage (consente il funzionamento locale offline)
    try {
        const localVal = localStorage.getItem("last_location");
        if (localVal) return JSON.parse(localVal);
    } catch(e) {
        console.warn("localStorage non accessibile:", e);
    }

    // 2. Fallback su cookie tradizionale
    const name = "last_location=";
    const decodedCookie = decodeURIComponent(document.cookie);
    const ca = decodedCookie.split(';');
    for(let i = 0; i < ca.length; i++) {
        let c = ca[i].trim();
        if (c.indexOf(name) === 0) {
            try {
                return JSON.parse(c.substring(name.length, c.length));
            } catch(e) {
                console.error("Errore nel parsing del cookie last_location", e);
                return null;
            }
        }
    }
    return null;
}

// --- AUTOCOMPLETAMENTO / GEOCODING ---
function initAutocomplete() {
    const input = document.getElementById("citySearch");
    const dropdown = document.getElementById("suggestionsDropdown");
    const clearBtn = document.getElementById("clearSearch");
    const spinner = document.getElementById("searchSpinner");
    
    let debounceTimer = null;

    input.addEventListener("input", (e) => {
        const query = e.target.value.trim();
        
        if (query.length > 0) {
            clearBtn.classList.remove("d-none");
        } else {
            clearBtn.classList.add("d-none");
            dropdown.classList.add("d-none");
            return;
        }

        if (query.length < 3) {
            dropdown.classList.add("d-none");
            return;
        }

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            fetchSuggestions(query, dropdown, spinner);
        }, 300);
    });

    clearBtn.addEventListener("click", () => {
        input.value = "";
        clearBtn.classList.add("d-none");
        dropdown.classList.add("d-none");
        input.focus();
    });

    document.addEventListener("click", (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add("d-none");
        }
    });
}

async function fetchSuggestions(query, dropdown, spinner) {
    spinner.classList.remove("d-none");
    try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=10&language=it&format=json`;
        const response = await fetch(url);
        if (!response.ok) throw new Error("Errore Geocoding API");

        const data = await response.json();
        renderSuggestions(data.results || [], dropdown);
    } catch (err) {
        console.error("Errore autocompletamento:", err);
    } finally {
        spinner.classList.add("d-none");
    }
}

function renderSuggestions(results, dropdown) {
    dropdown.innerHTML = "";
    
    if (results.length === 0) {
        dropdown.classList.add("d-none");
        return;
    }

    results.forEach(item => {
        const regionText = [item.admin1, item.country].filter(Boolean).join(", ");
        
        const suggestionItem = document.createElement("div");
        suggestionItem.className = "suggestion-item";
        suggestionItem.innerHTML = `
            <i class="suggestion-icon" data-lucide="map-pin"></i>
            <div class="suggestion-text">
                <span class="suggestion-name">${escapeHtml(item.name)}</span>
                <span class="suggestion-region">${escapeHtml(regionText)}</span>
            </div>
        `;

        // Click sulla località proposta
        suggestionItem.addEventListener("click", () => {
            inputCityName(item.name);
            dropdown.classList.add("d-none");
            // Salva la scelta nel cookie
            setSavedLocationCookie(item.latitude, item.longitude, item.name, regionText);
            loadForecast(item.latitude, item.longitude, item.name, regionText);
        });

        dropdown.appendChild(suggestionItem);
    });

    lucide.createIcons({ attrs: { class: 'size-18 suggestion-icon' } });
    dropdown.classList.remove("d-none");
}

function inputCityName(name) {
    document.getElementById("citySearch").value = name;
    document.getElementById("clearSearch").classList.remove("d-none");
}

// --- CARICAMENTO DATI METEO & CALCOLO MEDIA ---
async function loadForecast(lat, lon, name, region) {
    const loader = document.getElementById("mainLoader");
    const dashboard = document.getElementById("forecastDashboard");
    
    loader.classList.remove("d-none");
    dashboard.classList.add("d-none");

    try {
        // Prepariamo le chiamate concorrenti per i 5 provider
        const fetchPromises = PROVIDERS.map(p => fetchProviderData(p.name, p.endpoint, lat, lon));
        const results = await Promise.all(fetchPromises);

        // Filtra i provider che hanno risposto con successo
        const successfulModels = results.filter(r => r !== null);

        if (successfulModels.length === 0) {
            throw new Error("Nessuno dei modelli meteo ha risposto. Riprova più tardi.");
        }

        // Calcola la media dei modelli in tempo reale lato client
        const averageModel = computeAverageForecast(successfulModels);

        // Aggiorna l'intestazione
        document.getElementById("currentLocationName").textContent = name;
        document.getElementById("currentLocationRegion").textContent = region || "Italia";
        document.getElementById("currentCoords").textContent = `Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`;

        // Raggruppa i dati per data
        processGroupedData(averageModel, successfulModels);

        // Disegna l'interfaccia
        renderDaysGrid();
        selectDay(0);

        dashboard.classList.remove("d-none");
    } catch (err) {
        alert(err.message);
    } finally {
        loader.classList.add("d-none");
    }
}

async function fetchProviderData(providerName, baseUrl, lat, lon) {
    try {
        const url = `${baseUrl}latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&timezone=Europe/Rome`;
        //const url = `${baseUrl}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&timezone=Europe/Rome`;
        const response = await fetch(url);
        if (!response.ok) {
            console.warn(`Provider ${providerName} non raggiungibile: ${response.status}`);
            return null;
        }

        const data = await response.json();
        if (!data.hourly || !data.hourly.time) return null;

        const hourlyForecasts = [];
        const h = data.hourly;

        for (let i = 0; i < h.time.length; i++) {
            // Verifica e gestisce esplicitamente i valori null restituiti dall'API per ciascuna metrica
            let temp = (h.temperature_2m && h.temperature_2m[i] !== null && h.temperature_2m[i] !== undefined) ? h.temperature_2m[i] : null;
            let hum = (h.relative_humidity_2m && h.relative_humidity_2m[i] !== null && h.relative_humidity_2m[i] !== undefined) ? h.relative_humidity_2m[i] : null;
            let prec = (h.precipitation && h.precipitation[i] !== null && h.precipitation[i] !== undefined) ? h.precipitation[i] : null;
            let code = (h.weather_code && h.weather_code[i] !== null && h.weather_code[i] !== undefined) ? h.weather_code[i] : null;
            let wind = (h.wind_speed_10m && h.wind_speed_10m[i] !== null && h.wind_speed_10m[i] !== undefined) ? h.wind_speed_10m[i] : null;

            hourlyForecasts.push({
                dateTime: h.time[i],
                temperature: temp,
                humidity: hum,
                precipitation: prec,
                weatherCode: code,
                windSpeed: wind
            });
        }

        return {
            providerName: providerName,
            hourlyForecasts: hourlyForecasts
        };
    } catch (e) {
        console.error(`Errore fetch per ${providerName}:`, e);
        return null;
    }
}

function computeAverageForecast(models) {
    const averageModel = {
        providerName: "Media dei Modelli",
        hourlyForecasts: []
    };

    // Estrai tutti i timestamp orari unici dal primo modello di successo
    const firstModel = models[0];
    const times = firstModel.hourlyForecasts.map(h => h.dateTime);

    times.forEach(time => {
        // Raccogli i dati di tutti i modelli per questa ora
        const forecastsAtHour = [];
        models.forEach(m => {
            const match = m.hourlyForecasts.find(h => h.dateTime === time);
            if (match) forecastsAtHour.push(match);
        });

        if (forecastsAtHour.length > 0) {
            // Estrae solo i valori numerici non nulli per calcolare la media corretta
            const temps = forecastsAtHour.filter(f => f.temperature !== null).map(f => f.temperature);
            const hums = forecastsAtHour.filter(f => f.humidity !== null).map(f => f.humidity);
            const precs = forecastsAtHour.filter(f => f.precipitation !== null).map(f => f.precipitation);
            const winds = forecastsAtHour.filter(f => f.windSpeed !== null).map(f => f.windSpeed);

            const avgTemp = temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
            const avgHum = hums.length > 0 ? hums.reduce((a, b) => a + b, 0) / hums.length : null;
            const avgPrec = precs.length > 0 ? precs.reduce((a, b) => a + b, 0) / precs.length : null;
            const avgWind = winds.length > 0 ? winds.reduce((a, b) => a + b, 0) / winds.length : null;

            // Codice meteo: prendiamo quello del primo modello disponibile o preferibilmente ECMWF
            let repCode = null;
            const validCodes = forecastsAtHour.filter(f => f.weatherCode !== null);
            if (validCodes.length > 0) {
                repCode = validCodes[0].weatherCode;
                const ecmwf = validCodes.find(f => f.weatherCode !== 0);
                if (ecmwf) repCode = ecmwf.weatherCode;
            }

            averageModel.hourlyForecasts.push({
                dateTime: time,
                temperature: avgTemp !== null ? Number(avgTemp.toFixed(1)) : null,
                humidity: avgHum !== null ? Number(avgHum.toFixed(1)) : null,
                precipitation: avgPrec !== null ? Number(avgPrec.toFixed(2)) : null,
                weatherCode: repCode,
                windSpeed: avgWind !== null ? Number(avgWind.toFixed(1)) : null
            });
        }
    });

    return averageModel;
}

function processGroupedData(averageModel, models) {
    const daysMap = {};

    // Inizializza i giorni sulla base dei timestamp della media
    averageModel.hourlyForecasts.forEach(h => {
        const dateStr = h.dateTime.split("T")[0];
        if (!daysMap[dateStr]) {
            daysMap[dateStr] = {
                dateStr: dateStr,
                averageHours: [],
                providerHours: {}
            };
        }
        daysMap[dateStr].averageHours.push(h);
    });

    // Associa le ore corrispondenti per i modelli
    models.forEach(m => {
        m.hourlyForecasts.forEach(h => {
            const dateStr = h.dateTime.split("T")[0];
            if (daysMap[dateStr]) {
                if (!daysMap[dateStr].providerHours[m.providerName]) {
                    daysMap[dateStr].providerHours[m.providerName] = [];
                }
                daysMap[dateStr].providerHours[m.providerName].push(h);
            }
        });
    });

    // Ordina cronologicamente
    groupedForecastData = Object.values(daysMap).sort((a, b) => a.dateStr.localeCompare(b.dateStr));
}

// --- INTERAZIONE UI ED EVENTI ---
function setChartType(type) {
    if (currentChartType === type) return;
    currentChartType = type;
    
    const btnTemp = document.getElementById("btnChartTemp");
    const btnPrec = document.getElementById("btnChartPrec");
    const titleSpan = document.getElementById("chartSectionTitle");
    
    if (type === 'temp') {
        btnTemp.classList.add("active");
        btnPrec.classList.remove("active");
        titleSpan.textContent = "Andamento Temperature delle 24h";
    } else {
        btnTemp.classList.remove("active");
        btnPrec.classList.add("active");
        titleSpan.textContent = "Andamento Precipitazioni delle 24h";
    }
    
    if (groupedForecastData.length > 0 && groupedForecastData[selectedDayIndex]) {
        updateChart(groupedForecastData[selectedDayIndex]);
    }
}

function renderDaysGrid() {
    const grid = document.getElementById("daysGrid");
    grid.innerHTML = "";

    groupedForecastData.forEach((day, index) => {
        // Filtra esplicitamente i valori null per evitare calcoli errati o NaN
        const temps = day.averageHours.map(h => h.temperature).filter(t => t !== null);
        const maxTemp = temps.length > 0 ? Math.max(...temps) : null;
        const minTemp = temps.length > 0 ? Math.min(...temps) : null;

        const maxTempText = maxTemp !== null ? Math.round(maxTemp) + "°" : "-";
        const minTempText = minTemp !== null ? Math.round(minTemp) + "°" : "-";

        const midHourIndex = Math.floor(day.averageHours.length / 2);
        const representativeCode = day.averageHours[midHourIndex]?.weatherCode ?? 0;
        const iconName = getWmoIcon(representativeCode);

        const dateObj = new Date(day.dateStr);
        const dayName = dateObj.toLocaleDateString("it-IT", { weekday: "long" });
        const dateLabel = dateObj.toLocaleDateString("it-IT", { day: "numeric", month: "short" });

        const card = document.createElement("div");
        card.className = `day-card ${index === selectedDayIndex ? "active" : ""}`;
        card.innerHTML = `
            <div class="day-name">${dayName.substring(0, 3)}</div>
            <div class="day-date">${dateLabel}</div>
            <i class="day-icon" data-lucide="${iconName}"></i>
            <div class="day-temp-range">
                <span class="temp-max">${maxTempText}</span>
                <span class="temp-min">${minTempText}</span>
            </div>
        `;

        card.addEventListener("click", () => {
            selectDay(index);
        });

        grid.appendChild(card);
    });

    lucide.createIcons({ attrs: { class: 'day-icon' } });
}

function selectDay(index) {
    selectedDayIndex = index;
    
    const cards = document.querySelectorAll(".day-card");
    cards.forEach((c, idx) => {
        if (idx === index) c.classList.add("active");
        else c.classList.remove("active");
    });

    const selectedDay = groupedForecastData[index];
    if (!selectedDay) return;

    const dateObj = new Date(selectedDay.dateStr);
    const dayLong = dateObj.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
    document.getElementById("selectedDayLabel").textContent = dayLong;

    updateChart(selectedDay);
    updateTable(selectedDay);
}

// --- GRAFICI CHART.JS ---
function updateChart(selectedDay) {
    const hours = selectedDay.averageHours.map(h => {
        const timePart = h.dateTime.split("T")[1];
        return timePart.substring(0, 5);
    });

    const isTemp = currentChartType === 'temp';
    const yLabelSuffix = isTemp ? "°C" : " mm";

    const datasets = [
        {
            label: isTemp ? "Media Modelli" : "Media Precipitazioni",
            data: selectedDay.averageHours.map(h => isTemp ? h.temperature : h.precipitation),
            borderColor: isTemp ? "#a5b4fc" : "#67e8f9",
            backgroundColor: isTemp ? "rgba(99, 102, 241, 0.15)" : "rgba(6, 182, 212, 0.15)",
            borderWidth: 4,
            pointRadius: 3,
            pointBackgroundColor: isTemp ? "#6366f1" : "#06b6d4",
            tension: 0.3,
            fill: true,
            order: 1
        }
    ];

    const providerColorsTemp = {
        "ECMWF (Europeo)": "#6366f1",
        "DWD ICON (Tedesco)": "#f59e0b",
        "NOAA GFS (USA)": "#ef4444",
        "CMC GEM (Canadese)": "#10b981",
        "MeteoFrance (Francese)": "#ec4899",
        "MeteoSwiss (Svizzero)": "rgb(60, 255, 1)"
    };

    const providerColorsPrec = {
        "ECMWF (Europeo)": "#06b6d4",
        "DWD ICON (Tedesco)": "#0284c7",
        "NOAA GFS (USA)": "#2563eb",
        "CMC GEM (Canadese)": "#10b981",
        "MeteoFrance (Francese)": "#8b5cf6",
        "MeteoSwiss (Svizzero)": "rgb(60, 255, 1)"
    };

    const colors = isTemp ? providerColorsTemp : providerColorsPrec;

    Object.keys(colors).forEach(providerName => {
        const providerHrs = selectedDay.providerHours[providerName];
        if (providerHrs && providerHrs.length > 0) {
            datasets.push({
                label: providerName.split(" ")[0],
                data: providerHrs.map(h => isTemp ? h.temperature : h.precipitation),
                borderColor: colors[providerName],
                borderWidth: 2,
                borderDash: [4, 4],
                pointRadius: 0,
                tension: 0.3,
                fill: false,
                order: 2
            });
        }
    });

    const ctx = document.getElementById("tempComparisonChart").getContext("2d");

    if (tempChart) {
        tempChart.destroy();
    }

    tempChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: hours,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: "index"
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: "#94a3b8", font: { family: "Outfit", size: 11 } }
                },
                y: {
                    grid: { color: "rgba(255, 255, 255, 0.05)" },
                    ticks: {
                        color: "#94a3b8",
                        callback: function(value) { return value + yLabelSuffix; },
                        font: { family: "Outfit", size: 11 }
                    }
                }
            },
            plugins: {
                legend: {
                    position: "top",
                    labels: { color: "#f8fafc", font: { family: "Outfit", size: 12 }, usePointStyle: true, padding: 15 }
                },
                tooltip: {
                    backgroundColor: "rgba(15, 20, 38, 0.95)",
                    titleFont: { family: "Outfit", size: 13, weight: "bold" },
                    bodyFont: { family: "Outfit", size: 12 },
                    borderColor: "rgba(255, 255, 255, 0.08)",
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        label: function(context) {
                            return ` ${context.dataset.label}: ${context.raw.toFixed(1)}${yLabelSuffix}`;
                        }
                    }
                }
            }
        }
    });
}

// --- TABELLA DI DETTAGLIO ---
function updateTable(selectedDay) {
    const tbody = document.getElementById("hourlyTableBody");
    tbody.innerHTML = "";

    selectedDay.averageHours.forEach((avgHour, index) => {
        const timePart = avgHour.dateTime.split("T")[1].substring(0, 5);
        const iconName = getWmoIcon(avgHour.weatherCode);

        let providerCellsHtml = "";
        PROVIDERS.forEach(p => {
            const provHrs = selectedDay.providerHours[p.name];
            const hourData = provHrs ? provHrs[index] : null;

            // Protezione contro i valori nulli di temperatura e precipitazioni
            if (hourData && hourData.temperature !== null) {
                let diffText = "";
                if (avgHour.temperature !== null) {
                    const diff = hourData.temperature - avgHour.temperature;
                    const diffSign = diff > 0 ? "+" : "";
                    const diffClass = diff > 0.5 ? "text-danger" : (diff < -0.5 ? "text-primary" : "text-muted");
                    diffText = Math.abs(diff) > 0.2 ? `<span class="small ${diffClass}">(${diffSign}${diff.toFixed(1)}°)</span>` : "";
                }

                const tempText = hourData.temperature.toFixed(1) + "°C";
                const precText = (hourData.precipitation !== null && hourData.precipitation > 0) ? hourData.precipitation.toFixed(1) + " mm" : "-";

                providerCellsHtml += `
                    <td>
                        <div class="cell-data">
                            <span class="cell-val">${tempText} ${diffText}</span>
                            <span class="cell-sub">${precText}</span>
                        </div>
                    </td>
                `;
            } else {
                providerCellsHtml += `<td><span class="text-muted">-</span></td>`;
            }
        });

        // Formatta in modo sicuro i dati per la colonna della media
        const tempVal = avgHour.temperature !== null ? avgHour.temperature.toFixed(1) + "°C" : "-";
        const precVal = (avgHour.precipitation !== null && avgHour.precipitation > 0) ? avgHour.precipitation.toFixed(1) + " mm" : "0 mm";
        const windVal = avgHour.windSpeed !== null ? avgHour.windSpeed + " km/h" : "-";

        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${timePart}</td>
            <td class="col-avg">
                <div class="avg-cell-content">
                    <i class="weather-badge-icon text-indigo" data-lucide="${iconName}"></i>
                    <div class="cell-data">
                        <span class="cell-val fw-bold">${tempVal}</span>
                        <span class="cell-sub text-light-50">
                            Pioggia: ${precVal} | 
                            Vento: ${windVal}
                        </span>
                    </div>
                </div>
            </td>
            ${providerCellsHtml}
        `;

        tbody.appendChild(row);
    });

    lucide.createIcons({ attrs: { class: 'weather-badge-icon' } });
}

// --- UTILITY ---
function getWmoIcon(code) {
    if (code === 0) return 'sun';
    if (code >= 1 && code <= 3) return 'cloud-sun';
    if (code === 45 || code === 48) return 'cloud-fog';
    if (code >= 51 && code <= 57) return 'cloud-drizzle';
    if (code >= 61 && code <= 67) return 'cloud-rain';
    if (code >= 71 && code <= 77) return 'snowflake';
    if (code >= 80 && code <= 82) return 'cloud-rain-wind';
    if (code >= 85 && code <= 86) return 'snowflake';
    if (code >= 95 && code <= 99) return 'cloud-lightning';
    return 'cloud';
}

function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
}
